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
      offlineMode: false
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
    
    // Use the provided Render deployment URL
    const serverUrl = 'https://dungeon-crawler-lazc.onrender.com';
    
    // Connect to socket.io server with better connection options for mobile devices
    this.socket = io(serverUrl, {
      reconnection: true,
      reconnectionAttempts: 15, // Increase from 10 to 15
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000, // Increase from 5000 to 10000
      timeout: 30000, // Increase from 20000 to 30000
      transports: ['polling', 'websocket'], // Try polling first, then WebSocket (better for mobile)
      upgrade: true, // Explicitly allow transport upgrade
      forceNew: true, // Use a new connection each time
      autoConnect: false // Don't connect automatically, we'll do it manually
    });
    
    // Set up connection event handlers
    this.setupConnectionHandlers();
    
    // Register game event handlers
    this.setupGameEventHandlers();
    
    // Manually connect after a short delay to allow for page to fully load
    setTimeout(() => {
      this.socket.connect();
    }, 500);
    
    // Join the game once connected
    this.socket.on('connect', () => {
      this.connectionState.connected = true;
      this.connectionState.playerId = this.socket.id;
      this.connectionState.reconnectAttempts = 0;
      this.joinGame(playerData);
    });
  }
  
  /**
   * Setup connection-related socket handlers
   */
  setupConnectionHandlers() {
    // Connection events
    this.socket.on('connect', () => {
      console.log('Connected to server!');
      this.connectionState.connected = true;
      this.connectionState.reconnecting = false;
      this.connectionState.error = null;
      
      // Clear any reconnect timers
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      
      // Reset reconnect attempts
      this.connectionState.reconnectAttempts = 0;
      
      // Trigger event handlers
      this.triggerEvent('connect');
      
      // Add a visible notification for mobile
      this.showConnectionStatus('Connected to server', 'success');
    });
    
    this.socket.on('disconnect', (reason) => {
      console.log('Disconnected from server, reason:', reason);
      this.connectionState.connected = false;
      
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
      Object.keys(players).forEach((id) => {
        if (id === this.socket.id) {
          // This is our player, update local state if needed
          // (position is controlled locally, but we might need to update other properties)
          this.triggerEvent('currentPlayer', players[id]);
        } else {
          // Other players - add them to the game
          this.otherPlayers[id] = players[id];
          this.triggerEvent('playerJoined', players[id]);
        }
      });
    });
    
    // New player joins
    this.socket.on('newPlayer', (playerInfo) => {
      // Add the new player to our tracking
      this.otherPlayers[playerInfo.id] = playerInfo;
      
      // Trigger event for game scene to create sprite
      this.triggerEvent('playerJoined', playerInfo);
    });
    
    // Player disconnects
    this.socket.on('playerDisconnected', (playerInfo) => {
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
      this.otherPlayers = players;
      this.triggerEvent('roomPlayersUpdated', players);
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
      const enemiesData = enemies.map(enemy => ({
        id: enemy.id || enemy.enemyId, // Use consistent ID property
        type: enemy.enemyType,
        x: enemy.x,
        y: enemy.y,
        health: enemy.health,
        isDead: enemy.isDead || false,
        state: enemy.state || 'idle'
      }));
      
      // Send full enemy state
      this.socket.emit('syncEnemies', enemiesData);
    }
  }
  
  /**
   * Sync all items to the server
   * @param {Array} items - The array of item objects
   */
  syncItems(items) {
    if (!this.socket || !this.connectionState.connected) return;
    
    // Only the host should sync items to prevent conflicts
    if (this.isHost()) {
      const itemsData = items.map(item => ({
        id: item.id || item.itemId || `item_${items.indexOf(item)}`,
        type: item.itemType,
        x: item.x,
        y: item.y,
        collected: item.collected || false
      }));
      
      this.socket.emit('syncItems', itemsData);
    }
  }
  
  /**
   * Request a full sync from the server
   */
  requestFullSync() {
    if (!this.socket || !this.connectionState.connected) return;
    
    this.socket.emit('requestFullSync', {
      room: this.gameScene.roomId || 'default'
    });
  }
  
  /**
   * Check if this client is the host (first player in the room)
   * @returns {boolean} Whether this client is the host
   */
  isHost() {
    // If we're the first player to join, we're the host
    // The server should send this information
    return this.connectionState.isHost || 
           (this.gameScene && this.gameScene.isHost) || 
           Object.keys(this.otherPlayers).length === 0;
  }
}

// Create singleton instance
const multiplayerService = new MultiplayerService();

export default multiplayerService;