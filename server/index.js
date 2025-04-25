const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// Game state
const players = {};
const enemies = {};
const items = {};
let rooms = {};

// Keep track of active socket connections to prevent duplicates
const activeConnections = new Set();

// Create server
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// In production, serve the built client
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '..', 'dist')));
  
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
  });
}

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);
  
  // Check if this is a duplicate connection from the same client
  // Socket.io handshake contains transport info and headers we can use
  const clientId = socket.handshake.headers['x-client-id'] || socket.id;
  
  if (activeConnections.has(clientId)) {
    console.log('Duplicate connection detected:', clientId);
    // Just acknowledge the connection but don't process further
    socket.emit('connectionStatus', { 
      status: 'duplicate', 
      message: 'Already connected with another socket' 
    });
    return;
  }
  
  // Add to active connections
  activeConnections.add(clientId);
  
  // When a player joins the game
  socket.on('playerJoin', (playerData) => {
    console.log('Player joined:', socket.id, playerData.name);
    
    // Add player to our players object
    players[socket.id] = {
      id: socket.id,
      name: playerData.name || `Player ${Object.keys(players).length + 1}`,
      x: playerData.x || 100,
      y: playerData.y || 100,
      health: playerData.health || 100,
      direction: playerData.direction || 'down',
      animation: playerData.animation || 'player_idle_down',
      room: playerData.room || 'default',
      isAttacking: false,
      lastUpdated: Date.now()
    };
    
    // Join the room
    socket.join(players[socket.id].room);
    
    // Initialize room if it doesn't exist
    if (!rooms[players[socket.id].room]) {
      rooms[players[socket.id].room] = {
        players: [],
        seed: Math.floor(Math.random() * 1000000), // For procedural generation
        enemies: {},
        items: {}
      };
    }
    
    // Add player to room
    rooms[players[socket.id].room].players.push(socket.id);
    
    // Send the current players to the new player
    socket.emit('currentPlayers', players);
    
    // Send dungeon seed for consistent generation
    socket.emit('dungeonSeed', rooms[players[socket.id].room].seed);
    
    // Send enemies in the room
    socket.emit('currentEnemies', rooms[players[socket.id].room].enemies);
    
    // Send items in the room
    socket.emit('currentItems', rooms[players[socket.id].room].items);
    
    // Update all other players with the new player
    socket.to(players[socket.id].room).emit('newPlayer', players[socket.id]);
  });
  
  // When a player moves
  socket.on('playerMovement', (movementData) => {
    if (players[socket.id]) {
      players[socket.id].x = movementData.x;
      players[socket.id].y = movementData.y;
      players[socket.id].direction = movementData.direction;
      players[socket.id].animation = movementData.animation;
      players[socket.id].lastUpdated = Date.now();
      
      // Emit player movement to all players in the room
      socket.to(players[socket.id].room).emit('playerMoved', players[socket.id]);
    }
  });
  
  // When a player attacks
  socket.on('playerAttack', (attackData) => {
    if (players[socket.id]) {
      players[socket.id].isAttacking = true;
      players[socket.id].attackDirection = attackData.direction;
      
      // Emit attack to all players in the room
      socket.to(players[socket.id].room).emit('playerAttacked', {
        id: socket.id,
        direction: attackData.direction,
        x: players[socket.id].x,
        y: players[socket.id].y
      });
      
      // Reset attack state after a short delay
      setTimeout(() => {
        if (players[socket.id]) {
          players[socket.id].isAttacking = false;
        }
      }, 300);
    }
  });
  
  // When a player takes damage
  socket.on('playerDamage', (damageData) => {
    if (players[socket.id]) {
      players[socket.id].health = damageData.health;
      
      // Broadcast player health update
      io.to(players[socket.id].room).emit('playerHealthUpdate', {
        id: socket.id,
        health: players[socket.id].health
      });
      
      // If player died
      if (players[socket.id].health <= 0) {
        io.to(players[socket.id].room).emit('playerDied', {
          id: socket.id
        });
      }
    }
  });
  
  // When a player respawns
  socket.on('playerRespawn', (respawnData) => {
    if (players[socket.id]) {
      players[socket.id].x = respawnData.x;
      players[socket.id].y = respawnData.y;
      players[socket.id].health = 100;
      
      // Broadcast player respawn
      io.to(players[socket.id].room).emit('playerRespawned', {
        id: socket.id,
        x: players[socket.id].x,
        y: players[socket.id].y,
        health: players[socket.id].health
      });
    }
  });
  
  // Enemy updates
  socket.on('enemyUpdate', (enemyData) => {
    if (players[socket.id] && players[socket.id].room) {
      const room = players[socket.id].room;
      
      // Update enemy state
      if (!rooms[room].enemies[enemyData.id]) {
        rooms[room].enemies[enemyData.id] = enemyData;
      } else {
        rooms[room].enemies[enemyData.id] = {
          ...rooms[room].enemies[enemyData.id],
          ...enemyData
        };
      }
      
      // Broadcast enemy update to all players in the room
      socket.to(room).emit('enemyUpdated', rooms[room].enemies[enemyData.id]);
    }
  });
  
  // Handle enemy synchronization from host player
  socket.on('syncEnemies', (enemiesData) => {
    if (players[socket.id] && players[socket.id].room) {
      const room = players[socket.id].room;
      
      // Update all enemies in the room with the data from host
      if (rooms[room]) {
        // Replace the entire enemies object instead of updating individually
        rooms[room].enemies = {};
        
        // Process each enemy and store by ID
        Object.values(enemiesData).forEach(enemyData => {
          if (enemyData.id) {
            rooms[room].enemies[enemyData.id] = enemyData;
          }
        });
        
        // Broadcast updates to all clients except sender
        socket.to(room).emit('currentEnemies', rooms[room].enemies);
      }
    }
  });
  
  // Item updates (pickup, spawn, etc)
  socket.on('itemUpdate', (itemData) => {
    if (players[socket.id] && players[socket.id].room) {
      const room = players[socket.id].room;
      
      // Update item state
      if (!rooms[room].items[itemData.id]) {
        rooms[room].items[itemData.id] = itemData;
      } else {
        rooms[room].items[itemData.id] = {
          ...rooms[room].items[itemData.id],
          ...itemData
        };
      }
      
      // Broadcast item update to all players in the room
      io.to(room).emit('itemUpdated', rooms[room].items[itemData.id]);
    }
  });
  
  // Item picked up
  socket.on('itemPickup', (itemData) => {
    if (players[socket.id] && players[socket.id].room) {
      const room = players[socket.id].room;
      
      // Remove item from room
      if (rooms[room].items[itemData.id]) {
        delete rooms[room].items[itemData.id];
        
        // Broadcast item pickup to all players in the room
        io.to(room).emit('itemRemoved', {
          id: itemData.id,
          playerId: socket.id
        });
      }
    }
  });
  
  // When player changes room
  socket.on('changeRoom', (roomData) => {
    if (players[socket.id]) {
      const oldRoom = players[socket.id].room;
      const newRoom = roomData.room;
      
      // Leave old room
      if (rooms[oldRoom]) {
        const playerIndex = rooms[oldRoom].players.indexOf(socket.id);
        if (playerIndex !== -1) {
          rooms[oldRoom].players.splice(playerIndex, 1);
        }
        socket.leave(oldRoom);
        
        // Notify players in old room
        socket.to(oldRoom).emit('playerLeft', { id: socket.id });
      }
      
      // Join new room
      socket.join(newRoom);
      players[socket.id].room = newRoom;
      
      // Initialize new room if it doesn't exist
      if (!rooms[newRoom]) {
        rooms[newRoom] = {
          players: [],
          seed: Math.floor(Math.random() * 1000000),
          enemies: {},
          items: {}
        };
      }
      
      // Add player to new room
      rooms[newRoom].players.push(socket.id);
      
      // Send dungeon seed for consistent generation
      socket.emit('dungeonSeed', rooms[newRoom].seed);
      
      // Get current players in new room
      const roomPlayers = {};
      rooms[newRoom].players.forEach(playerId => {
        if (players[playerId]) {
          roomPlayers[playerId] = players[playerId];
        }
      });
      
      // Send room data to the player
      socket.emit('roomPlayers', roomPlayers);
      socket.emit('currentEnemies', rooms[newRoom].enemies);
      socket.emit('currentItems', rooms[newRoom].items);
      
      // Update other players in new room
      socket.to(newRoom).emit('newPlayer', players[socket.id]);
    }
  });
  
  // Cleanup when a player disconnects
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Remove from active connections tracking
    const clientId = socket.handshake.headers['x-client-id'] || socket.id;
    activeConnections.delete(clientId);
    
    // Remove this player from our players object
    if (players[socket.id]) {
      const room = players[socket.id].room;
      
      // Remove from room if it exists
      if (rooms[room]) {
        const playerIndex = rooms[room].players.indexOf(socket.id);
        if (playerIndex !== -1) {
          rooms[room].players.splice(playerIndex, 1);
        }
        
        // If room is empty, clean it up
        if (rooms[room].players.length === 0) {
          delete rooms[room];
        }
      }
      
      // Notify other players
      io.to(room).emit('playerDisconnected', { id: socket.id });
      
      // Delete the player
      delete players[socket.id];
    }
  });
});

// Periodic cleanup of inactive players (5 minutes without updates)
setInterval(() => {
  const now = Date.now();
  Object.keys(players).forEach((playerId) => {
    if (now - players[playerId].lastUpdated > 5 * 60 * 1000) {
      const room = players[playerId].room;
      
      console.log('Removing inactive player:', playerId);
      
      // Remove from room
      if (rooms[room]) {
        const playerIndex = rooms[room].players.indexOf(playerId);
        if (playerIndex !== -1) {
          rooms[room].players.splice(playerIndex, 1);
        }
        
        // If room is empty, clean it up
        if (rooms[room].players.length === 0) {
          delete rooms[room];
        }
      }
      
      // Notify other players
      io.to(room).emit('playerDisconnected', { id: playerId });
      
      // Delete the player
      delete players[playerId];
    }
  });
}, 60 * 1000);

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Access locally via: http://localhost:${PORT}`);
  console.log(`Access from other devices via: http://<your-ip-address>:${PORT}`);
  
  // Better mobile compatibility logging
  console.log(`Server configured for mobile access: CORS enabled, timeouts increased`);
});

// Increase timeout for slower mobile connections
io.engine.pingTimeout = 60000;  // 60 seconds
io.engine.pingInterval = 25000; // 25 seconds

module.exports = { app, server, io };