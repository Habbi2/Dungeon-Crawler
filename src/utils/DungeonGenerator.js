class DungeonGenerator {
  constructor(config) {
    // Configuration with defaults
    this.config = {
      width: config.width || 50,
      height: config.height || 50,
      roomSizeRange: config.roomSizeRange || [7, 12],
      roomCountRange: config.roomCountRange || [5, 10],
      corridorWidth: config.corridorWidth || 2,
      specialRoomsChance: config.specialRoomsChance || 0.3, // Chance for special rooms
      trapDensity: config.trapDensity || 0.03, // Density of traps in corridors
      theme: config.theme || 'dungeon' // Allow different dungeon themes
    };
    
    // Initialize dungeon properties
    this.rooms = [];
    this.corridors = [];
    this.grid = [];
    this.traps = [];
    this.roomTypes = ['normal', 'treasure', 'challenge', 'boss', 'shop'];
  }
  
  generate() {
    // Reset any previous generation
    this.rooms = [];
    this.corridors = [];
    this.traps = [];
    
    // Create a 2D grid filled with walls
    this.grid = Array(this.config.height).fill().map(() => 
      Array(this.config.width).fill(1)  // 1 = wall
    );
    
    // Generate rooms
    this.generateRooms();
    
    // Connect rooms with corridors
    this.connectRooms();
    
    // Assign room types
    this.assignRoomTypes();
    
    // Generate traps
    this.generateTraps();
    
    // Add some decorative elements
    this.addDecorations();
    
    // Return the generated dungeon data
    return {
      width: this.config.width,
      height: this.config.height,
      grid: this.grid,
      rooms: this.rooms,
      corridors: this.corridors,
      traps: this.traps,
      entities: this.generateEntities()
    };
  }
  
  generateRooms() {
    // Determine number of rooms to generate
    const roomCount = Phaser.Math.Between(
      this.config.roomCountRange[0], 
      this.config.roomCountRange[1]
    );
    
    // Keep track of attempts to prevent infinite loops
    let attempts = 0;
    const maxAttempts = 100;
    
    while (this.rooms.length < roomCount && attempts < maxAttempts) {
      attempts++;
      
      // Generate a room with random dimensions
      const roomWidth = Phaser.Math.Between(
        this.config.roomSizeRange[0],
        this.config.roomSizeRange[1]
      );
      
      const roomHeight = Phaser.Math.Between(
        this.config.roomSizeRange[0],
        this.config.roomSizeRange[1]
      );
      
      // Random position (leaving margin around edges)
      const roomX = Phaser.Math.Between(1, this.config.width - roomWidth - 1);
      const roomY = Phaser.Math.Between(1, this.config.height - roomHeight - 1);
      
      // Create the room object
      const newRoom = {
        x: roomX,
        y: roomY,
        width: roomWidth,
        height: roomHeight,
        centerX: Math.floor(roomX + roomWidth / 2),
        centerY: Math.floor(roomY + roomHeight / 2)
      };
      
      // Check if this room overlaps with any existing rooms
      let overlapping = false;
      
      for (let i = 0; i < this.rooms.length; i++) {
        const existingRoom = this.rooms[i];
        
        // Add a buffer around rooms to prevent them from being too close
        if (
          newRoom.x - 2 < existingRoom.x + existingRoom.width + 2 &&
          newRoom.x + newRoom.width + 2 > existingRoom.x - 2 &&
          newRoom.y - 2 < existingRoom.y + existingRoom.height + 2 &&
          newRoom.y + newRoom.height + 2 > existingRoom.y - 2
        ) {
          overlapping = true;
          break;
        }
      }
      
      // If no overlap, add the room
      if (!overlapping) {
        this.rooms.push(newRoom);
        
        // Carve the room into the grid
        for (let y = newRoom.y; y < newRoom.y + newRoom.height; y++) {
          for (let x = newRoom.x; x < newRoom.x + newRoom.width; x++) {
            this.grid[y][x] = 0;  // 0 = floor
          }
        }
      }
    }
  }
  
  connectRooms() {
    // For each room (except the last), connect to the next room
    for (let i = 0; i < this.rooms.length - 1; i++) {
      const currentRoom = this.rooms[i];
      const nextRoom = this.rooms[i + 1];
      
      // Create a corridor between the rooms
      this.createCorridor(currentRoom, nextRoom);
    }
    
    // Connect the last room to the first to create a loop (optional)
    if (this.rooms.length > 2) {
      this.createCorridor(this.rooms[this.rooms.length - 1], this.rooms[0]);
    }
    
    // Add some random connections for more complex layouts (optional)
    const extraConnections = Math.floor(this.rooms.length / 3);
    for (let i = 0; i < extraConnections; i++) {
      const roomA = this.rooms[Phaser.Math.Between(0, this.rooms.length - 1)];
      const roomB = this.rooms[Phaser.Math.Between(0, this.rooms.length - 1)];
      
      // Don't connect a room to itself
      if (roomA !== roomB) {
        this.createCorridor(roomA, roomB);
      }
    }
  }
  
  createCorridor(roomA, roomB) {
    // Get center points of each room
    const pointA = {
      x: Math.floor(roomA.x + roomA.width / 2),
      y: Math.floor(roomA.y + roomA.height / 2)
    };
    
    const pointB = {
      x: Math.floor(roomB.x + roomB.width / 2),
      y: Math.floor(roomB.y + roomB.height / 2)
    };
    
    // 50% chance to draw corridors horizontally first, then vertically
    const corridorType = Math.random() > 0.5;
    
    // Store corridor points for later use
    const corridor = {
      startX: pointA.x,
      startY: pointA.y,
      endX: pointB.x,
      endY: pointB.y
    };
    
    if (corridorType) {
      this.drawHorizontalCorridor(pointA.x, pointB.x, pointA.y);
      this.drawVerticalCorridor(pointA.y, pointB.y, pointB.x);
    } else {
      this.drawVerticalCorridor(pointA.y, pointB.y, pointA.x);
      this.drawHorizontalCorridor(pointA.x, pointB.x, pointB.y);
    }
    
    this.corridors.push(corridor);
  }
  
  drawHorizontalCorridor(startX, endX, y) {
    const start = Math.min(startX, endX);
    const end = Math.max(startX, endX);
    const width = this.config.corridorWidth;
    
    // Draw the horizontal part of the corridor
    for (let x = start; x <= end; x++) {
      // Make corridor wider if specified
      for (let w = 0; w < width; w++) {
        const yPos = y - Math.floor(width / 2) + w;
        if (yPos >= 0 && yPos < this.config.height && x >= 0 && x < this.config.width) {
          this.grid[yPos][x] = 0;  // 0 = floor
        }
      }
    }
  }
  
  drawVerticalCorridor(startY, endY, x) {
    const start = Math.min(startY, endY);
    const end = Math.max(startY, endY);
    const width = this.config.corridorWidth;
    
    // Draw the vertical part of the corridor
    for (let y = start; y <= end; y++) {
      // Make corridor wider if specified
      for (let w = 0; w < width; w++) {
        const xPos = x - Math.floor(width / 2) + w;
        if (y >= 0 && y < this.config.height && xPos >= 0 && xPos < this.config.width) {
          this.grid[y][xPos] = 0;  // 0 = floor
        }
      }
    }
  }
  
  addDecorations() {
    // Add some random wall decorations
    for (let y = 1; y < this.config.height - 1; y++) {
      for (let x = 1; x < this.config.width - 1; x++) {
        // If this is a wall tile
        if (this.grid[y][x] === 1) {
          // Check if it's adjacent to a floor tile (edge wall)
          if (
            this.grid[y-1][x] === 0 || 
            this.grid[y+1][x] === 0 || 
            this.grid[y][x-1] === 0 || 
            this.grid[y][x+1] === 0
          ) {
            // 10% chance to make this a decorative wall tile
            if (Math.random() < 0.1) {
              this.grid[y][x] = 2;  // 2 = decorative wall
            }
          }
        }
      }
    }
    
    // Add some decorations to floors
    for (let y = 1; y < this.config.height - 1; y++) {
      for (let x = 1; x < this.config.width - 1; x++) {
        // If this is a floor tile
        if (this.grid[y][x] === 0) {
          // 2% chance to add a decoration
          if (Math.random() < 0.02) {
            this.grid[y][x] = 3;  // 3 = floor decoration
          }
        }
      }
    }
  }
  
  generateEntities() {
    // Create an array to hold entity data
    const entities = [];
    
    // Add enemies to each room (except the first)
    for (let i = 1; i < this.rooms.length; i++) {
      const room = this.rooms[i];
      
      // Add 1-3 enemies per room
      const enemyCount = Phaser.Math.Between(1, 3);
      for (let j = 0; j < enemyCount; j++) {
        // Position within the room (avoiding edges)
        const x = Phaser.Math.Between(room.x + 1, room.x + room.width - 2);
        const y = Phaser.Math.Between(room.y + 1, room.y + room.height - 2);
        
        // Determine enemy type
        let enemyType = 'skeleton';
        const typeRoll = Math.random();
        
        if (typeRoll > 0.7) {
          enemyType = 'vampire';
        }
        
        // Add boss to the last room
        if (i === this.rooms.length - 1 && j === 0) {
          enemyType = 'boss';
        }
        
        entities.push({
          type: 'enemy',
          enemyType: enemyType,
          x: x,
          y: y
        });
      }
      
      // Add treasure to some rooms
      if (Math.random() < 0.4) {
        const x = Phaser.Math.Between(room.x + 1, room.x + room.width - 2);
        const y = Phaser.Math.Between(room.y + 1, room.y + room.height - 2);
        
        entities.push({
          type: 'treasure',
          treasureType: Math.random() < 0.7 ? 'chest' : 'gold',
          x: x,
          y: y
        });
      }
    }
    
    // Add exit in the last room
    const exitRoom = this.rooms[this.rooms.length - 1];
    entities.push({
      type: 'exit',
      x: exitRoom.centerX,
      y: exitRoom.centerY
    });
    
    return entities;
  }

  generateTraps() {
    this.traps = [];
    
    // Place traps in corridors
    this.corridors.forEach(corridor => {
      // Determine number of traps for this corridor
      const corridorLength = Math.max(
        Math.abs(corridor.startX - corridor.endX), 
        Math.abs(corridor.startY - corridor.endY)
      );
      
      // Calculate number of traps based on length and density
      const trapCount = Math.floor(corridorLength * this.config.trapDensity);
      
      for (let i = 0; i < trapCount; i++) {
        // Random position along the corridor
        let x, y;
        if (corridor.startX === corridor.endX) {
          // Vertical corridor
          x = corridor.startX;
          y = Phaser.Math.Between(
            Math.min(corridor.startY, corridor.endY) + 1, 
            Math.max(corridor.startY, corridor.endY) - 1
          );
        } else {
          // Horizontal corridor
          x = Phaser.Math.Between(
            Math.min(corridor.startX, corridor.endX) + 1, 
            Math.max(corridor.startX, corridor.endX) - 1
          );
          y = corridor.startY;
        }
        
        // Ensure trap is not placed near room entrances
        let tooCloseToRoom = false;
        for (const room of this.rooms) {
          const distToRoom = Math.min(
            Math.abs(x - room.x), Math.abs(x - (room.x + room.width)),
            Math.abs(y - room.y), Math.abs(y - (room.y + room.height))
          );
          if (distToRoom <= 2) {
            tooCloseToRoom = true;
            break;
          }
        }
        
        // Only add trap if not too close to room entrances
        if (!tooCloseToRoom) {
          this.traps.push({
            x: x,
            y: y,
            type: Math.random() < 0.7 ? 'spike' : 'poison',
            visible: Math.random() < 0.6 // 60% traps are visible
          });
          
          // Mark trap on grid if visible
          if (this.traps[this.traps.length - 1].visible) {
            this.grid[y][x] = 4; // 4 = trap
          }
        }
      }
    });
    
    return this.traps;
  }
  
  // Add a method to assign room types (normal, treasure, challenge, boss)
  assignRoomTypes() {
    // First room is always normal (starting room)
    if (this.rooms.length > 0) {
      this.rooms[0].type = 'normal';
    }
    
    // Last room is always boss room
    if (this.rooms.length > 1) {
      this.rooms[this.rooms.length - 1].type = 'boss';
    }
    
    // Assign types to other rooms
    for (let i = 1; i < this.rooms.length - 1; i++) {
      if (Math.random() < this.config.specialRoomsChance) {
        // Choose a special room type
        const availableTypes = ['treasure', 'challenge', 'shop'];
        const typeIndex = Math.floor(Math.random() * availableTypes.length);
        this.rooms[i].type = availableTypes[typeIndex];
      } else {
        this.rooms[i].type = 'normal';
      }
    }
  }
}

export default DungeonGenerator;