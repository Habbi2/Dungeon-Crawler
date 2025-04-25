import { io } from 'socket.io-client';

/**
 * MultiplayerService handles socket.io connections and real-time multiplayer functionality
 */
class MultiplayerService {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.gameScene = null;
    this.otherPlayers = {};
    this.serverEnemies = {};
    this.serverItems = {};
    
    // Connection states
    this.connectionState = {
      connected: false,
      error: null,
      reconnecting: false,
      playerId: null,
      reconnectAttempts: 0,
      maxReconnectAttempts: 10,
      offlineMode: false,
      isConnecting: false  // Add a flag to track connection attempts
    };
    
    // Event handlers
    this.eventHandlers = {};
    
    // Reconnection timer
    this.reconnectTimer = null;
    
    // Periodic reconnection check when in offline mode
    this.offlineModeReconnectTimer = null;
    
    // Sync settings
    this.syncConfig = {
      updateRate: 100,              // How often to send position updates (ms)
      interpolationDelay: 100,      // Buffer time for interpolation (ms)
      maxPredictionSteps: 10,       // Maximum prediction steps
      snapDistance: 100,            // Distance at which to snap instead of interpolate
      positionBuffer: [],           // Buffer for position interpolation
      lastUpdateTime: 0,            // Last time an update was sent
      enemySyncRate: 200,           // How often to sync enemy states (ms)
      itemSyncRate: 500,            // How often to sync item states (ms)
      fullSyncRate: 5000            // How often to do a full state sync (ms)
    };
    
    // Timer for regular position updates
    this.updateTimer = null;
    
    // Timer for enemy synchronization
    this.enemySyncTimer = null;
    
    // Timer for item synchronization
    this.itemSyncTimer = null;
  }
  
  /**
   * Initialize the multiplayer service
   * @param {Phaser.Scene} gameScene - The main game scene
   * @param {Object} playerData - Initial player data
   */
  init(gameScene, playerData) {
    this.gameScene = gameScene;
    this.initialPlayerData = playerData; // Store player data for use by connection handler
    
    // Use the provided Render deployment URL
    const serverUrl = 'https://dungeon-crawler-lazc.onrender.com';
    
    // Check if we're already connecting or connected
    if (this.connectionState.isConnecting || this.connectionState.connected) {
      console.log('Already connecting or connected to server, skipping new connection');
      return;
    }
    
    // Set connecting state
    this.connectionState.isConnecting = true;
    
    // Connect to socket.io server with optimized connection options for better WebSocket reliability
    this.socket = io(serverUrl, {
      reconnection: true,
      reconnectionAttempts: 15,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 30000,
      transports: ['websocket', 'polling'], // Try WebSocket first as primary transport
      upgrade: true,
      forceNew: true,
      autoConnect: false, // We'll connect manually
      withCredentials: false, // Helps with some CORS issues
      extraHeaders: {
        "pragma": "no-cache",
        "cache-control": "no-cache"
      }
    });
    
    // Set up connection event handlers
    this.setupConnectionHandlers();
    
    // Register game event handlers
    this.setupGameEventHandlers();
    
    // Manually connect after a short delay to allow for page to fully load
    setTimeout(() => {
      console.log('Connecting to game server...');
      if (!this.connectionState.connected) {
        this.socket.connect();
      }
    }, 500);
  }
  
  /**
   * Setup connection-related socket handlers
   */
  setupConnectionHandlers() {
    // Connection events
    this.socket.on('connect', () => {
      console.log('Connected to server!');
      this.connectionState.connected = true;
      this.connectionState.isConnecting = false; // Reset connecting flag
      this.connectionState.reconnecting = false;
      this.connectionState.error = null;
      this.connectionState.playerId = this.socket.id;
      
      // Clear any reconnect timers
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      
      // Reset reconnect attempts
      this.connectionState.reconnectAttempts = 0;
      
      // Join the game with the initial player data on first connect
      if (this.initialPlayerData) {
        this.joinGame(this.initialPlayerData);
      }
      
      // Trigger event handlers
      this.triggerEvent('connect');
      
      // Add a visible notification for mobile
      this.showConnectionStatus('Connected to server', 'success');
    });
    
    this.socket.on('disconnect', (reason) => {
      console.log('Disconnected from server, reason:', reason);
      this.connectionState.connected = false;
      this.connectionState.isConnecting = false; // Reset connecting state on disconnect
      
      // If the server closed the connection, try to reconnect manually
      if (reason === 'transport close' || reason === 'transport error') {
        this.handleTransportError();
      }
      
      // Trigger event handlers
      this.triggerEvent('disconnect', { reason });
      
      // Add a visible notification for mobile
      this.showConnectionStatus('Disconnected from server: ' + reason, 'error');
    });
    
    this.socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      this.connectionState.error = error.message || 'Connection failed';
      this.connectionState.isConnecting = false; // Reset connecting state on error
      
      // Handle transport errors specially
      if (error.type === 'TransportError') {
        this.handleTransportError();
      }
      
      // Trigger event handlers
      this.triggerEvent('error', error);
      
      // Add a visible notification for mobile
      this.showConnectionStatus('Connection error: ' + (error.message || error.type || 'Unknown error'), 'error');
    });
    
    this.socket.io.on('reconnect_attempt', (attemptNumber) => {
      console.log('Attempting to reconnect... Attempt #' + attemptNumber);
      this.connectionState.reconnecting = true;
      this.connectionState.reconnectAttempts = attemptNumber;
      
      // Trigger event handlers
      this.triggerEvent('reconnecting', { attempt: attemptNumber });
      
      // Add a visible notification for mobile
      this.showConnectionStatus('Attempting to reconnect... Attempt #' + attemptNumber, 'warning');
    });
    
    this.socket.io.on('reconnect', (attemptNumber) => {
      console.log('Reconnected after ' + attemptNumber + ' attempts!');
      this.connectionState.reconnecting = false;
      this.connectionState.connected = true;
      this.connectionState.error = null;
      
      // Trigger event handlers
      this.triggerEvent('reconnect', { attempt: attemptNumber });
      
      // Add a visible notification for mobile
      this.showConnectionStatus('Reconnected!', 'success');
    });
    
    this.socket.io.on('reconnect_error', (error) => {
      console.error('Reconnection error:', error);
      
      // Add a visible notification for mobile
      this.showConnectionStatus('Reconnection error: ' + (error.message || error.type || 'Unknown error'), 'error');
      
      // If we've reached max attempts, suggest manual refresh
      if (this.connectionState.reconnectAttempts >= this.connectionState.maxReconnectAttempts) {
        this.showConnectionStatus('Maximum reconnection attempts reached. Please refresh the page.', 'error', 0);
      }
    });
    
    this.socket.io.on('reconnect_failed', () => {
      console.error('Failed to reconnect after multiple attempts');
      this.connectionState.reconnecting = false;
      
      // Show a permanent error message
      this.showConnectionStatus('Failed to connect to server. Please check your connection and refresh the page.', 'error', 0);
      
      // Trigger event
      this.triggerEvent('reconnect_failed');
    });
  }
  
  /**
   * Handle transport errors specifically
   */
  handleTransportError() {
    console.log('Transport error detected, implementing custom reconnection strategy');
    
    // Cancel any existing reconnect attempts
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    // Update max reconnect attempts
    this.connectionState.maxReconnectAttempts = 15;
    
    if (this.connectionState.reconnectAttempts < this.connectionState.maxReconnectAttempts) {
      // Increment attempt counter
      this.connectionState.reconnectAttempts++;
      
      // Calculate delay with exponential backoff (1s, 2s, 4s, 8s, etc.)
      const delay = Math.min(1000 * Math.pow(2, this.connectionState.reconnectAttempts - 1), 10000);
      
      console.log(`Will attempt reconnection in ${delay}ms (attempt ${this.connectionState.reconnectAttempts} of ${this.connectionState.maxReconnectAttempts})`);
      this.showConnectionStatus(`Reconnecting in ${Math.round(delay/1000)}s... (${this.connectionState.reconnectAttempts}/${this.connectionState.maxReconnectAttempts})`, 'warning');
      
      // Set timer for reconnection
      this.reconnectTimer = setTimeout(() => {
        if (!this.connectionState.connected) {
          console.log('Attempting to reconnect...');
          
          try {
            // Try to reconnect by creating a new socket connection
            if (this.socket) {
              // Disconnect completely first
              this.socket.disconnect();
              
              // Try alternative transport if available (toggle between websocket and polling)
              const currentTransports = this.socket.io.opts.transports || ['polling', 'websocket'];
              let newTransports = [...currentTransports];
              // Swap the order of transports to try the other option first
              if (currentTransports[0] === 'polling') {
                newTransports = ['websocket', 'polling'];
              } else {
                newTransports = ['polling', 'websocket'];
              }
              
              this.socket.io.opts.transports = newTransports;
              console.log(`Trying connection with transports: ${newTransports.join(', ')}`);
              
              // Force a new connection attempt
              this.socket.connect();
            }
          } catch (err) {
            console.error('Error during reconnection attempt:', err);
            this.triggerEvent('error', { message: 'Reconnection error', error: err });
          }
        }
      }, delay);
    } else {
      console.log('Maximum reconnection attempts reached');
      
      // Provide specific instructions for mobile users
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      const message = isMobile 
        ? 'Connection failed. Try switching between WiFi and cellular data, then refresh the page.' 
        : 'Unable to connect to server. Please check your connection and refresh the page.';
      
      this.showConnectionStatus(message, 'error', 0);
      
      // Try offline mode if available
      this.triggerEvent('offlineMode');
    }
  }
  
  /**
   * Show connection status on mobile
   * @param {string} message - Status message
   * @param {string} type - Message type: 'success', 'error', 'warning'
   * @param {number} duration - How long to show the message (0 for permanent)
   */
  showConnectionStatus(message, type = 'info', duration = 5000) {
    // Trigger event that UI scene can listen for
    this.triggerEvent('connectionStatus', { message, type });
    
    // Also create or update a DOM element for mobile users
    // This provides a fallback if the game UI is not visible
    let statusElement = document.getElementById('connection-status');
    
    if (!statusElement) {
      statusElement = document.createElement('div');
      statusElement.id = 'connection-status';
      statusElement.style.position = 'absolute';
      statusElement.style.top = '40px';
      statusElement.style.left = '0';
      statusElement.style.right = '0';
      statusElement.style.padding = '10px';
      statusElement.style.textAlign = 'center';
      statusElement.style.zIndex = '1000';
      statusElement.style.fontFamily = 'Arial, sans-serif';
      statusElement.style.fontSize = '14px';
      document.body.appendChild(statusElement);
    }
    
    // Set color based on type
    let backgroundColor, textColor;
    switch(type) {
      case 'success':
        backgroundColor = 'rgba(0, 128, 0, 0.8)';
        textColor = 'white';
        break;
      case 'error':
        backgroundColor = 'rgba(200, 0, 0, 0.8)';
        textColor = 'white';
        break;
      case 'warning':
        backgroundColor = 'rgba(255, 165, 0, 0.8)';
        textColor = 'black';
        break;
      default:
        backgroundColor = 'rgba(0, 0, 0, 0.8)';
        textColor = 'white';
    }
    
    statusElement.style.backgroundColor = backgroundColor;
    statusElement.style.color = textColor;
    statusElement.textContent = message;
    statusElement.style.display = 'block';
    
    // Auto hide after duration (if not permanent)
    if (duration > 0) {
      setTimeout(() => {
        if (statusElement.parentNode) {
          statusElement.style.display = 'none';
        }
      }, duration);
    }
  }
  
  /**
   * Setup game-related socket handlers
   */
  setupGameEventHandlers() {
    // Current players in the game
    this.socket.on('currentPlayers', (players) => {
      console.log('Received current players data:', players);
      
      // Clear existing player tracking - important for late joiners
      this.otherPlayers = {};
      
      Object.keys(players).forEach((id) => {
        if (id === this.socket.id) {
          // This is our player, update local state if needed
          this.triggerEvent('currentPlayer', players[id]);
        } else {
          // Other players - add them to the game
          this.otherPlayers[id] = players[id];
          this.triggerEvent('playerJoined', players[id]);
        }
      });
      
      console.log('Updated otherPlayers after currentPlayers event:', this.otherPlayers);
    });
    
    // New player joins
    this.socket.on('newPlayer', (playerInfo) => {
      console.log('New player joined:', playerInfo);
      
      // Add the new player to our tracking
      this.otherPlayers[playerInfo.id] = playerInfo;
      
      // Trigger event for game scene to create sprite
      this.triggerEvent('playerJoined', playerInfo);
    });
    
    // Player disconnects
    this.socket.on('playerDisconnected', (playerInfo) => {
      console.log('Player disconnected:', playerInfo);
      
      // Remove from our tracking
      if (this.otherPlayers[playerInfo.id]) {
        delete this.otherPlayers[playerInfo.id];
      }
      
      // Trigger event for game scene
      this.triggerEvent('playerLeft', playerInfo);
    });
    
    // Player moves
    this.socket.on('playerMoved', (playerInfo) => {
      // Update our local tracking
      if (this.otherPlayers[playerInfo.id]) {
        this.otherPlayers[playerInfo.id] = {
          ...this.otherPlayers[playerInfo.id],
          x: playerInfo.x,
          y: playerInfo.y,
          direction: playerInfo.direction,
          animation: playerInfo.animation
        };
      }
      
      // Trigger event for game scene
      this.triggerEvent('playerMoved', playerInfo);
    });
    
    // Player attacks
    this.socket.on('playerAttacked', (attackInfo) => {
      if (this.otherPlayers[attackInfo.id]) {
        this.otherPlayers[attackInfo.id].isAttacking = true;
        
        // Reset attacking state after animation completes
        setTimeout(() => {
          if (this.otherPlayers[attackInfo.id]) {
            this.otherPlayers[attackInfo.id].isAttacking = false;
          }
        }, 300);
      }
      
      // Trigger event for game scene
      this.triggerEvent('playerAttacked', attackInfo);
    });
    
    // Player health update
    this.socket.on('playerHealthUpdate', (healthInfo) => {
      if (this.otherPlayers[healthInfo.id]) {
        this.otherPlayers[healthInfo.id].health = healthInfo.health;
      }
      
      // Trigger event for game scene
      this.triggerEvent('playerHealthUpdate', healthInfo);
    });
    
    // Player died
    this.socket.on('playerDied', (playerInfo) => {
      // Trigger event for game scene
      this.triggerEvent('playerDied', playerInfo);
    });
    
    // Player respawned
    this.socket.on('playerRespawned', (playerInfo) => {
      if (this.otherPlayers[playerInfo.id]) {
        this.otherPlayers[playerInfo.id].x = playerInfo.x;
        this.otherPlayers[playerInfo.id].y = playerInfo.y;
        this.otherPlayers[playerInfo.id].health = playerInfo.health;
      }
      
      // Trigger event for game scene
      this.triggerEvent('playerRespawned', playerInfo);
    });
    
    // Enemy updates
    this.socket.on('currentEnemies', (enemies) => {
      this.serverEnemies = enemies;
      this.triggerEvent('enemiesUpdated', enemies);
    });
    
    this.socket.on('enemyUpdated', (enemyInfo) => {
      this.serverEnemies[enemyInfo.id] = enemyInfo;
      this.triggerEvent('enemyUpdated', enemyInfo);
    });
    
    // Item updates
    this.socket.on('currentItems', (items) => {
      this.serverItems = items;
      this.triggerEvent('itemsUpdated', items);
    });
    
    this.socket.on('itemUpdated', (itemInfo) => {
      this.serverItems[itemInfo.id] = itemInfo;
      this.triggerEvent('itemUpdated', itemInfo);
    });
    
    this.socket.on('itemRemoved', (itemInfo) => {
      if (this.serverItems[itemInfo.id]) {
        delete this.serverItems[itemInfo.id];
      }
      this.triggerEvent('itemRemoved', itemInfo);
    });
    
    // Dungeon generation seed
    this.socket.on('dungeonSeed', (seed) => {
      this.triggerEvent('dungeonSeed', seed);
    });
    
    // Room-specific events
    this.socket.on('roomPlayers', (players) => {
      console.log('Received room players update:', players);
      
      // Replace all players in the room
      this.otherPlayers = {};
      
      // Add all players in the current room except self
      Object.keys(players).forEach(id => {
        if (id !== this.socket.id) {
          this.otherPlayers[id] = players[id];
          this.triggerEvent('playerJoined', players[id]);
        }
      });
      
      // Notify that room players were updated
      this.triggerEvent('roomPlayersUpdated', this.otherPlayers);
    });

    // Handle host status update
    this.socket.on('hostStatus', (data) => {
      console.log('Host status update:', data);
      this.connectionState.isHost = data.isHost;
      
      if (data.isHost) {
        console.log('This client is now the room host');
      }
    });
  }
  
  /**
   * Join the game with player data
   * @param {Object} playerData - Initial player data
   */
  joinGame(playerData = {}) {
    if (this.socket && this.connectionState.connected) {
      this.socket.emit('playerJoin', {
        name: playerData.name || 'Player',
        x: playerData.x || 100,
        y: playerData.y || 100,
        health: playerData.health || 100,
        direction: playerData.direction || 'down',
        animation: playerData.animation || 'player_idle_down',
        room: playerData.room || 'default'
      });
    } else {
      console.error('Cannot join game: Not connected to server');
    }
  }
  
  /**
   * Send player movement to the server
   * @param {Object} movementData - Player movement data
   */
  updateMovement(movementData) {
    if (this.socket && this.connectionState.connected) {
      this.socket.emit('playerMovement', movementData);
    }
  }
  
  /**
   * Ensure all enemies target the player after server sync
   * @param {Array|Object} enemies - Collection of enemies to update
   * @param {Object} player - The player object to set as target
   */
  ensureEnemiesTargetPlayer(enemies, player) {
    if (!player) return;
    
    // Handle both array and object formats
    if (Array.isArray(enemies)) {
      enemies.forEach(enemy => {
        if (enemy && enemy.active) {
          this.setupEnemyBehavior(enemy, player);
        }
      });
    } else if (enemies && typeof enemies === 'object') {
      Object.values(enemies).forEach(enemy => {
        if (enemy && enemy.active) {
          this.setupEnemyBehavior(enemy, player);
        }
      });
    }
  }
  
  /**
   * Configure proper enemy AI behavior toward player
   * @param {Object} enemy - Enemy object to configure
   * @param {Object} player - Player target
   */
  setupEnemyBehavior(enemy, player) {
    // Set player as target
    enemy.target = player;
    
    // Ensure enemy has proper AI settings
    enemy.chasePlayer = true;
    enemy.aggroRange = enemy.aggroRange || 200;
    enemy.attackRange = enemy.attackRange || 40;
    
    // Make sure enemy's physics body won't move away on collision
    if (enemy.body) {
      enemy.body.pushable = false;
    }
    
    // Set aggro state if player is within range
    if (player) {
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance <= (enemy.aggroRange || 200)) {
        enemy.aggro = true;
        enemy.state = 'chase';
      }
    }
  }

  /**
   * Handle server enemy updates
   * @param {Object} enemies - The enemy data from server
   */
  receiveEnemyUpdates(enemies) {
    // Update our local tracking
    this.serverEnemies = {...enemies};
    
    // If we have a game scene and player, ensure enemies target the player
    if (this.gameScene && this.gameScene.player) {
      this.ensureEnemiesTargetPlayer(this.serverEnemies, this.gameScene.player);
      
      // Ensure enemy instances in the scene also target the player
      if (this.gameScene.enemies) {
        this.ensureEnemiesTargetPlayer(this.gameScene.enemies, this.gameScene.player);
      }
    }
    
    // Trigger event for game scene
    this.triggerEvent('enemiesUpdated', this.serverEnemies);
  }
  
  /**
   * Send player attack to the server
   * @param {Object} attackData - Attack data
   */
  playerAttack(attackData) {
    if (this.socket && this.connectionState.connected) {
      this.socket.emit('playerAttack', attackData);
    }
  }
  
  /**
   * Send player damage to the server
   * @param {Object} damageData - Damage data
   */
  playerDamage(damageData) {
    if (this.socket && this.connectionState.connected) {
      this.socket.emit('playerDamage', damageData);
    }
  }
  
  /**
   * Send player respawn to the server
   * @param {Object} respawnData - Respawn data
   */
  playerRespawn(respawnData) {
    if (this.socket && this.connectionState.connected) {
      this.socket.emit('playerRespawn', respawnData);
    }
  }
  
  /**
   * Send enemy update to the server
   * @param {Object} enemyData - Enemy data
   */
  updateEnemy(enemyData) {
    if (this.socket && this.connectionState.connected) {
      this.socket.emit('enemyUpdate', enemyData);
    }
  }
  
  /**
   * Send item update to the server
   * @param {Object} itemData - Item data
   */
  updateItem(itemData) {
    if (this.socket && this.connectionState.connected) {
      this.socket.emit('itemUpdate', itemData);
    }
  }
  
  /**
   * Send item pickup to the server
   * @param {Object} itemData - Item data
   */
  pickupItem(itemData) {
    if (this.socket && this.connectionState.connected) {
      this.socket.emit('itemPickup', itemData);
    }
  }
  
  /**
   * Change rooms
   * @param {string} roomId - The room to join
   */
  changeRoom(roomId) {
    if (this.socket && this.connectionState.connected) {
      this.socket.emit('changeRoom', { room: roomId });
    }
  }
  
  /**
   * Register event handler
   * @param {string} event - Event name
   * @param {function} callback - Callback function
   */
  on(event, callback) {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = [];
    }
    this.eventHandlers[event].push(callback);
  }
  
  /**
   * Remove event handler
   * @param {string} event - Event name
   * @param {function} callback - Callback function to remove
   */
  off(event, callback) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event] = this.eventHandlers[event]
        .filter(handler => handler !== callback);
    }
  }
  
  /**
   * Trigger event handlers
   * @param {string} event - Event name
   * @param {any} data - Event data
   */
  triggerEvent(event, data) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].forEach(handler => handler(data));
    }
  }
  
  /**
   * Disconnect from the server
   */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
  
  /**
   * Get connection state
   * @returns {Object} Current connection state
   */
  getConnectionState() {
    return { ...this.connectionState };
  }

  /**
   * Enable offline mode for single-player gameplay
   * when server connection is not available
   */
  enableOfflineMode() {
    // Set offline mode state
    this.connectionState.offlineMode = true;
    
    // Clear any existing connection attempts
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    // Create a fake player ID for local state management
    this.connectionState.playerId = 'offline-' + Date.now();
    
    console.log('Switching to offline mode');
    this.showConnectionStatus('Switched to offline mode. Multiplayer features unavailable.', 'warning', 0);
    
    // Try to reconnect periodically in the background
    this.setupOfflineModeReconnection();
    
    // Notify the game to adapt to offline mode
    this.triggerEvent('offlineModeEnabled');
    
    return this.connectionState.playerId;
  }
  
  /**
   * Setup periodic background reconnection attempts while in offline mode
   */
  setupOfflineModeReconnection() {
    // Clear any existing timer
    if (this.offlineModeReconnectTimer) {
      clearInterval(this.offlineModeReconnectTimer);
    }
    
    // Try to reconnect every 30 seconds
    this.offlineModeReconnectTimer = setInterval(() => {
      if (this.connectionState.offlineMode && !this.connectionState.connected) {
        console.log('Attempting background reconnection from offline mode');
        
        try {
          // Create a new socket connection if needed
          if (!this.socket) {
            this.createNewSocketConnection();
          } else {
            // Try to reconnect with existing socket
            this.socket.connect();
          }
        } catch (err) {
          console.log('Background reconnection attempt failed:', err);
          // Silent fail - we'll try again later
        }
      } else if (this.connectionState.connected) {
        // If we're somehow connected, disable offline mode
        this.disableOfflineMode();
      }
    }, 30000); // Check every 30 seconds
  }
  
  /**
   * Disable offline mode when connection is restored
   */
  disableOfflineMode() {
    if (this.connectionState.offlineMode) {
      this.connectionState.offlineMode = false;
      
      // Clear the reconnection timer
      if (this.offlineModeReconnectTimer) {
        clearInterval(this.offlineModeReconnectTimer);
        this.offlineModeReconnectTimer = null;
      }
      
      console.log('Exiting offline mode, server connection restored');
      this.showConnectionStatus('Server connection restored!', 'success');
      
      // Notify the game
      this.triggerEvent('offlineModeDisabled');
    }
  }
  
  /**
   * Create a new socket connection with the server
   * Used to reset connection after errors
   */
  createNewSocketConnection() {
    // Determine server URL based on environment
    const serverUrl = process.env.NODE_ENV === 'production' 
      ? window.location.origin 
      : 'http://localhost:3000';
    
    // First disconnect any existing socket
    if (this.socket) {
      this.socket.disconnect();
    }
    
    // Create a new connection
    this.socket = io(serverUrl, {
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      transports: ['polling', 'websocket'],
      forceNew: true
    });
    
    // Re-register all event handlers
    this.setupConnectionHandlers();
    this.setupGameEventHandlers();
    
    // Attempt connection
    this.socket.connect();
  }
  
  /**
   * Check if we're in offline mode
   * @returns {boolean} Is offline mode active
   */
  isOfflineMode() {
    return this.connectionState.offlineMode;
  }

  /**
   * Start synchronization intervals for various game elements
   * @param {Object} gameScene - The game scene object
   */
  startSyncIntervals(gameScene) {
    // Clear any existing timers
    this.clearSyncTimers();
    
    // Store reference to game scene
    this.gameScene = gameScene;
    
    // Start player position updates
    this.updateTimer = setInterval(() => {
      if (gameScene.player && this.connectionState.connected) {
        this.updateMovement({
          x: gameScene.player.x,
          y: gameScene.player.y,
          direction: gameScene.player.direction,
          animation: gameScene.player.anims.currentAnim ? gameScene.player.anims.currentAnim.key : 'player_idle_down'
        });
      }
    }, this.syncConfig.updateRate);
    
    // Start enemy sync interval
    this.enemySyncTimer = setInterval(() => {
      if (gameScene.enemies && gameScene.enemies.length > 0 && this.connectionState.connected) {
        this.syncEnemies(gameScene.enemies);
      }
    }, this.syncConfig.enemySyncRate);
    
    // Start item sync interval
    this.itemSyncTimer = setInterval(() => {
      if (gameScene.items && gameScene.items.length > 0 && this.connectionState.connected) {
        this.syncItems(gameScene.items);
      }
    }, this.syncConfig.itemSyncRate);
    
    // Periodic full state sync
    this.fullSyncTimer = setInterval(() => {
      if (this.connectionState.connected) {
        this.requestFullSync();
      }
    }, this.syncConfig.fullSyncRate);
  }
  
  /**
   * Clear all sync intervals
   */
  clearSyncTimers() {
    if (this.updateTimer) clearInterval(this.updateTimer);
    if (this.enemySyncTimer) clearInterval(this.enemySyncTimer);
    if (this.itemSyncTimer) clearInterval(this.itemSyncTimer);
    if (this.fullSyncTimer) clearInterval(this.fullSyncTimer);
    
    this.updateTimer = null;
    this.enemySyncTimer = null;
    this.itemSyncTimer = null;
    this.fullSyncTimer = null;
  }
  
  /**
   * Sync all enemies to the server
   * @param {Array} enemies - The array of enemy objects
   */
  syncEnemies(enemies) {
    if (!this.socket || !this.connectionState.connected) return;
    
    // Only the host should sync enemies to prevent conflicts
    if (this.isHost()) {
      try {
        // Process enemies appropriately based on data format
        let enemiesArray = enemies;
        if (!Array.isArray(enemies)) {
          // Handle if enemies is an object instead of array
          enemiesArray = Object.values(enemies);
        }
        
        // Skip sync if no enemies
        if (!enemiesArray || enemiesArray.length === 0) return;
        
        // Build a comprehensive enemy data map with consistent IDs
        const enemiesData = {};
        
        enemiesArray.forEach(enemy => {
          // Skip null enemies
          if (!enemy || !enemy.active) return;
          
          // Ensure each enemy has a consistent ID
          const enemyId = enemy.id || enemy.enemyId || `enemy_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
          
          // Assign ID if missing
          if (!enemy.id && !enemy.enemyId) {
            enemy.id = enemyId;
            enemy.enemyId = enemyId;
          }
          
          // Get velocity from enemy body
          let velocityX = 0;
          let velocityY = 0;
          
          if (enemy.body) {
            velocityX = enemy.body.velocity ? enemy.body.velocity.x : 0;
            velocityY = enemy.body.velocity ? enemy.body.velocity.y : 0;
          }
          
          // Force isMoving to be true if velocity indicates movement
          const isMoving = 
            (Math.abs(velocityX) > 1 || Math.abs(velocityY) > 1) || 
            (enemy.isMoving === true);
          
          // Get current direction from enemy
          let direction = enemy.direction || 'down';
          
          // Create a comprehensive data object for this enemy
          enemiesData[enemyId] = {
            id: enemyId,
            type: enemy.enemyType || enemy.type || 'skeleton',
            x: enemy.x,
            y: enemy.y,
            health: enemy.health || 100,
            maxHealth: enemy.maxHealth || 100,
            isDead: enemy.isDead || false,
            // Critical movement data
            isMoving: isMoving,
            velocityX: velocityX,
            velocityY: velocityY,
            direction: direction,
            animation: enemy.anims && enemy.anims.currentAnim ? enemy.anims.currentAnim.key : null,
            speed: enemy.speed || 50,
            state: enemy.state || 'idle', // Add enemy state
            aggro: enemy.aggro || false, // Add aggro state
            target: enemy.target ? { x: enemy.target.x, y: enemy.target.y } : null, // Add target info
            lastUpdate: Date.now()
          };
        });
        
        // Only send update if there are valid enemies to sync
        if (Object.keys(enemiesData).length > 0) {
          this.socket.emit('syncEnemies', enemiesData);
        }
      } catch (error) {
        console.error("Error syncing enemies:", error);
      }
    }
  }
  
  /**
   * Handle server enemy updates
   * @param {Object} enemies - The enemy data from server
   */
  receiveEnemyUpdates(enemies) {
    // Update our local tracking
    this.serverEnemies = {...enemies};
    
    // If we have a game scene and player, ensure enemies target the player
    if (this.gameScene && this.gameScene.player) {
      this.ensureEnemiesTargetPlayer(this.serverEnemies, this.gameScene.player);
      
      // Ensure enemy instances in the scene also target the player
      if (this.gameScene.enemies) {
        this.ensureEnemiesTargetPlayer(this.gameScene.enemies, this.gameScene.player);
      }
    }
    
    // Trigger event for game scene
    this.triggerEvent('enemiesUpdated', this.serverEnemies);
  }
  
  /**
   * Sync all items to the server
   * @param {Array} items - The array of item objects
   */
  syncItems(items) {
    if (!this.socket || !this.connectionState.connected) return;
    
    // Only the host should sync items to prevent conflicts
    if (this.isHost()) {
      // Create a comprehensive items data map with consistent IDs
      const itemsData = {};
      
      // Process items from Phaser group or array
      if (items.getChildren) {
        // If it's a Phaser group, use getChildren()
        items.getChildren().forEach((item, index) => {
          this.processItemForSync(item, index, itemsData);
        });
      } else {
        // Otherwise treat as array
        items.forEach((item, index) => {
          this.processItemForSync(item, index, itemsData);
        });
      }
      
      // Send full items state
      this.socket.emit('syncItems', itemsData);
    }
  }
  
  /**
   * Process individual item for sync
   * @param {Object} item - Item object
   * @param {number} index - Index for ID generation
   * @param {Object} itemsData - Data object to add to
   */
  processItemForSync(item, index, itemsData) {
    // Ensure each item has a consistent ID
    const itemId = item.id || item.itemId || `item_${Date.now()}_${index}`;
    
    // Assign ID if missing
    if (!item.id && !item.itemId) {
      item.id = itemId;
      item.itemId = itemId;
    }
    
    // Add to data map with complete properties
    itemsData[itemId] = {
      id: itemId,
      type: item.itemType || 'unknown',
      x: item.x,
      y: item.y,
      collected: item.collected || false,
      quality: item.quality || 'normal',
      value: item.value || 1,
      isOpen: item.isOpen || false,
      lastUpdate: Date.now()
    };
  }
  
  /**
   * Handle server item updates
   * @param {Object} items - The item data from server
   */
  receiveItemUpdates(items) {
    // Update our local tracking with full replace to avoid stale items
    this.serverItems = {...items};
    
    // Trigger event for game scene
    this.triggerEvent('itemsUpdated', this.serverItems);
  }
  
  /**
   * Request a full synchronization of game state from the server
   * This is useful for late joiners or after reconnection
   */
  requestFullSync() {
    if (this.socket && this.connectionState.connected) {
      console.log('Requesting full game state sync from server');
      this.socket.emit('requestFullSync', {
        room: this.gameScene?.roomId || 'default'
      });
    } else {
      console.error('Cannot request full sync: Not connected to server');
    }
  }
  
  /**
   * Synchronize all game state at once - comprehensive sync method
   * @param {Object} gameState - Current game state to synchronize
   */
  syncGameState(gameState) {
    if (!this.socket || !this.connectionState.connected) return;
    
    // Only the host should sync full state to prevent conflicts
    if (this.isHost()) {
      const fullState = {
        players: {},
        enemies: {},
        items: {},
        timestamp: Date.now(),
        room: this.gameScene?.roomId || 'default',
        seed: gameState.seed || null
      };
      
      // Synchronize players
      if (gameState.players) {
        Object.keys(gameState.players).forEach(id => {
          const player = gameState.players[id];
          fullState.players[id] = {
            id: id,
            name: player.name || 'Player',
            x: player.x,
            y: player.y,
            health: player.health || 100,
            direction: player.direction || 'down',
            animation: player.animation || 'player_idle_down',
            isAttacking: player.isAttacking || false,
            lastUpdated: Date.now()
          };
        });
      }
      
      // Synchronize enemies
      if (gameState.enemies && gameState.enemies.length > 0) {
        gameState.enemies.forEach(enemy => {
          const enemyId = enemy.id || enemy.enemyId || `enemy_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
          
          // Assign ID if missing
          if (!enemy.id && !enemy.enemyId) {
            enemy.id = enemyId;
            enemy.enemyId = enemyId;
          }
          
          // Add to data map
          fullState.enemies[enemyId] = {
            id: enemyId,
            type: enemy.enemyType || 'skeleton',
            x: enemy.x,
            y: enemy.y,
            health: enemy.health || 100,
            maxHealth: enemy.maxHealth || 100,
            isDead: enemy.isDead || false,
            state: enemy.state || 'idle',
            lastUpdate: Date.now()
          };
        });
      }
      
      // Synchronize items
      if (gameState.items) {
        // Handle both arrays and Phaser Groups
        const itemArray = gameState.items.getChildren ? gameState.items.getChildren() : gameState.items;
        
        itemArray.forEach((item, index) => {
          const itemId = item.id || item.itemId || `item_${Date.now()}_${index}`;
          
          // Assign ID if missing
          if (!item.id && !item.itemId) {
            item.id = itemId;
            item.itemId = itemId;
          }
          
          // Add to data map with complete properties
          fullState.items[itemId] = {
            id: itemId,
            type: item.itemType || 'unknown',
            x: item.x,
            y: item.y,
            collected: item.collected || false,
            quality: item.quality || 'normal',
            value: item.value || 1,
            isOpen: item.isOpen || false,
            lastUpdate: Date.now()
          };
        });
      }
      
      // Send full state to server
      this.socket.emit('syncGameState', fullState);
      console.log('Full game state synchronized with server');
    }
  }
  
  /**
   * Check if the current client is the host
   * @returns {boolean} True if this client is the host
   */
  isHost() {
    return this.connectionState.isHost === true;
  }
}

// Create singleton instance
const multiplayerService = new MultiplayerService();

export default multiplayerService;