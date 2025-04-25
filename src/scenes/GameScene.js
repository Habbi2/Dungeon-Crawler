import Phaser from 'phaser';
import DungeonGenerator from '../utils/DungeonGenerator';
import Player from '../objects/Player';
import Enemy from '../objects/Enemy';
import multiplayerService from '../multiplayer/MultiplayerService';
import RemotePlayerManager from '../multiplayer/RemotePlayerManager';

class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
    
    this.player = null;
    this.enemies = [];
    this.dungeon = null;
    this.map = null;
    this.items = [];
    this.traps = [];
    this.collisionLayer = null;
    this.levelNumber = 1;
    this.exit = null;
    
    // Camera settings
    this.cameraSettings = {
      lerp: 0.1,           // Camera smoothing factor (0-1)
      zoomLevel: 1.5,      // Default zoom level
      maxZoom: 2.5,        // Maximum zoom level
      minZoom: 1,          // Minimum zoom level
      shakeIntensity: 0.01 // Default shake intensity
    };
    
    // Mobile control settings
    this.mobileControls = {
      joystick: null,
      joystickRadius: 50,
      attackButton: null,
      attackButtonRadius: 40,
      enabled: false
    };
    
    // Touch controls
    this.touchTarget = new Phaser.Math.Vector2();
    this.isTouching = false;
    
    // Multiplayer
    this.isMultiplayer = true; // Set to false to disable multiplayer for testing
    this.remotePlayerManager = null;
    this.roomId = 'default';
    this.lastPositionUpdate = 0;
    this.positionUpdateInterval = 100; // Send position updates every 100ms
    this.playerName = `Player_${Math.floor(Math.random() * 1000)}`;
  }

  create() {
    // Get level number from data if it exists
    if (this.data.has('levelNumber')) {
      this.levelNumber = this.data.get('levelNumber');
    }
    
    // Check if we were passed multiplayer parameter from MenuScene
    if (this.scene.settings.data && this.scene.settings.data.multiplayer !== undefined) {
      this.isMultiplayer = this.scene.settings.data.multiplayer;
    }

    // If multiplayer is enabled, initialize the multiplayer service
    if (this.isMultiplayer) {
      this.initMultiplayer();
    } else {
      // Generate the dungeon with fixed seed when not in multiplayer
      this.generateDungeon();
    }

    // Show level message
    this.events.emit('showMessage', `Level ${this.levelNumber} - Good luck!`);
    
    // Set up events from UI scene for mobile controls
    this.events.on('joystickMove', (data) => {
      if (this.player) {
        this.player.mobileInputs = {
          up: data.y < -0.3,
          down: data.y > 0.3,
          left: data.x < -0.3,
          right: data.x > 0.3
        };
        
        // Also store the raw vector for smoother, analog-style controls
        this.player.mobileVector = { x: data.x, y: data.y };
      }
    });
    
    this.events.on('playerAttack', () => {
      if (this.player && this.player.canAttack()) {
        this.player.attack();
        
        // Send attack event to server in multiplayer mode
        if (this.isMultiplayer && multiplayerService.getConnectionState().connected) {
          multiplayerService.playerAttack({
            direction: this.player.direction
          });
        }
      }
    });
    
    // Reset transition flag
    this.isTransitioning = false;
    
    // Set up keyboard controls for zoom
    this.keys = this.input.keyboard.addKeys({
      zoomIn: Phaser.Input.Keyboard.KeyCodes.Z,
      zoomOut: Phaser.Input.Keyboard.KeyCodes.X,
      resetZoom: Phaser.Input.Keyboard.KeyCodes.C
    });
  }

  // Initialize multiplayer functionality
  initMultiplayer() {
    // Create remote player manager
    this.remotePlayerManager = new RemotePlayerManager(this);
    this.remotePlayerManager.init();
    
    // Initialize multiplayer service
    multiplayerService.on('connect', this.handleConnect.bind(this));
    multiplayerService.on('disconnect', this.handleDisconnect.bind(this));
    multiplayerService.on('dungeonSeed', this.handleDungeonSeed.bind(this));
    
    // Set up enemy and item synchronization handlers
    multiplayerService.on('enemiesUpdated', this.handleEnemiesUpdated.bind(this));
    multiplayerService.on('enemyUpdated', this.handleEnemyUpdated.bind(this));
    multiplayerService.on('itemsUpdated', this.handleItemsUpdated.bind(this));
    multiplayerService.on('itemUpdated', this.handleItemUpdated.bind(this));
    multiplayerService.on('itemRemoved', this.handleItemRemoved.bind(this));
    
    // Handle offline mode
    multiplayerService.on('offlineModeEnabled', this.handleOfflineModeEnabled.bind(this));
    multiplayerService.on('offlineModeDisabled', this.handleOfflineModeDisabled.bind(this));
    
    // Ensure collision layer safety in multiplayer
    this.collisionCheckSafety = {
      isReady: false,
      pendingColliders: []
    };
    
    // Set up sync timers
    this.syncTimers = {
      lastFullSync: 0,
      fullSyncInterval: 5000, // Full sync every 5 seconds
      lastQuickSync: 0,
      quickSyncInterval: 500 // Quick sync every 0.5 seconds
    };
    
    // Initialize with player data
    multiplayerService.init(this, {
      name: this.playerName,
      room: this.roomId,
      level: this.levelNumber
    });
  }

  // Handle successful connection to server
  handleConnect() {
    console.log('Connected to game server!');
    this.events.emit('showMessage', 'Connected to multiplayer server!');
    
    // Start the regular sync intervals for enemies, items and other game elements
    multiplayerService.startSyncIntervals(this);
    
    // First time connection, request full state to ensure we're in sync
    multiplayerService.requestFullSync();
  }

  // Handle disconnection from server
  handleDisconnect() {
    console.log('Disconnected from game server');
    this.events.emit('showMessage', 'Disconnected from server. Trying to reconnect...');
  }

  // Handle received dungeon seed from server
  handleDungeonSeed(seed) {
    console.log('Received dungeon seed:', seed);
    
    // Skip regeneration if already using this seed
    if (this.currentSeed === seed) {
      console.log('Already using this seed, skipping regeneration');
      return; // Exit early to avoid requesting another sync
    }
    
    // Store the seed for reference
    this.currentSeed = seed;
    
    // Flag to track the state of regeneration
    this.isRegeneratingMap = true;
    
    // Clear existing map and objects
    this.clearExistingDungeon();
    
    // Generate new dungeon with the provided seed
    this.generateDungeon(seed);
    
    // Add a flag to prevent multiple sync requests for the same seed
    if (!this.hasSyncedAfterSeedChange) {
      this.hasSyncedAfterSeedChange = true;
      
      // Always request a full sync after handling seed change to ensure all game objects are in sync
      if (this.isMultiplayer && multiplayerService.getConnectionState().connected) {
        // Add a short delay to ensure tilemap is fully initialized
        this.time.delayedCall(200, () => {
          // Request full state sync to get entities like enemies and items
          multiplayerService.requestFullSync();
          console.log('Requested full sync after map regeneration');
          
          // Reset the sync flag after a delay to allow for future seed changes
          this.time.delayedCall(1000, () => {
            this.hasSyncedAfterSeedChange = false;
          });
        });
      }
    }
    
    // Reset the regeneration flag
    this.isRegeneratingMap = false;
  }

  // Helper method to clear existing dungeon elements
  clearExistingDungeon() {
    // Clear any existing map
    if (this.map) {
      this.map.destroy();
    }
    
    // Clear any existing objects
    if (this.enemies) {
      this.enemies.forEach(enemy => {
        if (enemy && enemy.destroy) enemy.destroy();
      });
      this.enemies = [];
    }
    
    if (this.items) {
      if (this.items.getChildren) {
        this.items.getChildren().forEach(item => {
          if (item && item.destroy) item.destroy();
        });
      }
    }
    
    if (this.traps) {
      if (this.traps.getChildren) {
        this.traps.getChildren().forEach(trap => {
          if (trap && trap.destroy) trap.destroy();
        });
      }
    }
    
    if (this.exit && this.exit.destroy) {
      this.exit.destroy();
    }
    
    // Explicitly clear all existing colliders to prevent issues with old references
    this.physics.world.colliders.destroy();
    
    // Reset collision check safety system
    this.collisionCheckSafety = {
      isReady: false,
      pendingColliders: []
    };
  }

  // Handle server-provided enemy updates
  handleEnemiesUpdated(enemies) {
    if (!this.isMultiplayer) return;
    
    // Skip verbose logging to reduce console spam
    // Only log enemy count for performance monitoring
    console.log(`Received enemy updates from server: ${Object.keys(enemies).length} enemies`);
    
    // If we're not the host, update or create enemies
    if (!multiplayerService.isHost()) {
      // Keep track of which enemies we've updated
      const updatedEnemies = new Set();
      
      // Update or create enemies from the server data
      Object.keys(enemies).forEach(enemyId => {
        const enemyData = enemies[enemyId];
        updatedEnemies.add(enemyId);
        
        try {
          // Find existing enemy with this ID
          const existingEnemy = this.enemies.find(e => (e.id === enemyId || e.enemyId === enemyId));
          
          if (existingEnemy) {
            // Update existing enemy properties
            if (typeof existingEnemy.updateFromServer === 'function') {
              existingEnemy.updateFromServer(enemyData);
            } else {
              // Fallback manual update if method doesn't exist
              existingEnemy.x = enemyData.x;
              existingEnemy.y = enemyData.y;
              existingEnemy.health = enemyData.health || 100;
              existingEnemy.isDead = enemyData.isDead || false;
              
              if (existingEnemy.body) {
                existingEnemy.body.setVelocity(
                  enemyData.velocityX || 0,
                  enemyData.velocityY || 0
                );
              }
            }
          } else {
            // Create new enemy if it doesn't exist
            console.log(`Creating new enemy from server data: ${enemyId}`);
            
            // Determine texture based on enemy type
            let texture = 'skeleton1_idle';
            if (enemyData.type === 'boss' || enemyData.type === 'vampire') {
              texture = 'vampire_idle';
            }
            
            // Create the enemy instance with proper error handling
            try {
              const newEnemy = new Enemy(
                this, 
                enemyData.x, 
                enemyData.y, 
                texture,
                enemyData.type || 'skeleton'
              );
              
              // Set initial properties
              newEnemy.id = enemyId;
              newEnemy.enemyId = enemyId;
              newEnemy.health = enemyData.health || 100;
              newEnemy.maxHealth = enemyData.maxHealth || 100;
              newEnemy.isDead = enemyData.isDead || false;
              newEnemy.serverControlled = true;
              newEnemy.isMoving = enemyData.isMoving || false;
              newEnemy.direction = enemyData.direction || 'down';
              newEnemy.speed = enemyData.speed || 50;
              
              // Explicitly set the target (this ensures enemy follows the player)
              newEnemy.target = this.player;
              
              // Set aggro radius based on enemy type
              newEnemy.aggroRadius = enemyData.type === 'boss' ? 250 : 150;
              
              // Set velocity for movement
              if (newEnemy.body) {
                newEnemy.body.setVelocity(
                  enemyData.velocityX || 0,
                  enemyData.velocityY || 0
                );
              }
              
              // Add to enemy array for tracking
              this.enemies.push(newEnemy);
              
              // Setup collisions for new enemy with proper error handling
              this.safeAddCollider(newEnemy, this.collisionLayer);
              this.safeAddCollider(newEnemy, this.player, this.handlePlayerEnemyCollision, null, this);
              
              // Apply initial animation
              if (newEnemy.isMoving) {
                newEnemy.playWalkAnimation();
              } else {
                newEnemy.playIdleAnimation();
              }
            } catch (error) {
              console.error(`Failed to create enemy ${enemyId}:`, error);
            }
          }
        } catch (error) {
          console.error(`Error processing enemy ${enemyId}:`, error);
        }
      });
      
      // Remove enemies that no longer exist on the server
      this.enemies = this.enemies.filter(enemy => {
        const enemyId = enemy.id || enemy.enemyId;
        if (!updatedEnemies.has(enemyId) && enemyId) {
          enemy.destroy();
          return false;
        }
        return true;
      });
    }
  }
  
  // Handle individual enemy update
  handleEnemyUpdated(enemyData) {
    if (!this.isMultiplayer || multiplayerService.isHost()) return;
    
    const existingEnemy = this.enemies.find(e => 
      (e.id === enemyData.id || e.enemyId === enemyData.id)
    );
    
    if (existingEnemy) {
      // Update the enemy directly using the updateFromServer method
      existingEnemy.updateFromServer(enemyData);
    } else {
      // If enemy doesn't exist yet, handle it through the bulk update method
      this.handleEnemiesUpdated({[enemyData.id]: enemyData});
    }
  }
  
  // Handle server-provided item updates
  handleItemsUpdated(items) {
    if (!this.isMultiplayer) return;
    
    console.log('Received item updates from server:', items);
    
    // If we're not the host, update the items
    if (!multiplayerService.isHost()) {
      // Track which items we've updated
      const updatedItems = new Set();
      
      // Update or create items from server data
      Object.keys(items).forEach(itemId => {
        const itemData = items[itemId];
        updatedItems.add(itemId);
        
        // Find existing item
        let existingItem = null;
        this.items.getChildren().forEach(item => {
          if (item.id === itemId || item.itemId === itemId) {
            existingItem = item;
          }
        });
        
        if (existingItem) {
          // Update existing item
          existingItem.x = itemData.x;
          existingItem.y = itemData.y;
          
          // Handle collected items
          if (itemData.collected && !existingItem.collected) {
            existingItem.collected = true;
            existingItem.destroy();
          }
        } else if (!itemData.collected) {
          // Create new item if it's not collected
          let newItem;
          
          switch (itemData.type) {
            case 'chest':
              newItem = this.physics.add.sprite(itemData.x, itemData.y, 'chest', 0);
              newItem.itemType = 'chest';
              newItem.isOpen = false;
              newItem.quality = itemData.quality || 'normal';
              break;
              
            case 'coin':
              newItem = this.physics.add.sprite(itemData.x, itemData.y, 'coin', 0);
              newItem.anims.play('coin_spin', true);
              newItem.itemType = 'coin';
              newItem.value = itemData.value || 1;
              break;
              
            case 'health_potion':
              newItem = this.physics.add.sprite(itemData.x, itemData.y, 'health_potion', 0);
              newItem.itemType = 'health_potion';
              break;
          }
          
          if (newItem) {
            newItem.itemId = itemId;
            this.items.add(newItem);
          }
        }
      });
      
      // Remove items that no longer exist on the server
      this.items.getChildren().forEach(item => {
        const itemId = item.id || item.itemId;
        if (!updatedItems.has(itemId) && itemId) {
          item.destroy();
        }
      });
    }
  }
  
  // Handle individual item update
  handleItemUpdated(itemData) {
    if (!this.isMultiplayer || multiplayerService.isHost()) return;
    
    // Find the corresponding item
    let matchedItem = null;
    this.items.getChildren().forEach(item => {
      if (item.id === itemData.id || item.itemId === itemData.id) {
        matchedItem = item;
      }
    });
    
    if (matchedItem) {
      // Update position
      matchedItem.x = itemData.x;
      matchedItem.y = itemData.y;
      
      // Handle chest opening
      if (itemData.type === 'chest' && itemData.isOpen && !matchedItem.isOpen) {
        matchedItem.isOpen = true;
        matchedItem.anims.play('chest_open');
      }
      
      // Handle collected state
      if (itemData.collected && !matchedItem.collected) {
        matchedItem.collected = true;
        matchedItem.destroy();
      }
    }
  }
  
  // Handle item removal
  handleItemRemoved(itemData) {
    if (!this.isMultiplayer || multiplayerService.isHost()) return;
    
    // Find and remove the item
    this.items.getChildren().forEach(item => {
      if (item.id === itemData.id || item.itemId === itemData.id) {
        item.destroy();
      }
    });
  }

  // Handle offline mode enable
  handleOfflineModeEnabled() {
    console.log('Offline mode enabled, adjusting game experience');
    this.events.emit('showMessage', 'Offline mode enabled. Multiplayer features disabled.');
    
    // We'll continue with the current game state but disable further sync attempts
    this.isOfflineMode = true;
    
    // If we don't have a dungeon yet, generate one with a random seed
    if (!this.dungeon) {
      const offlineSeed = Math.floor(Math.random() * 1000000);
      this.generateDungeon(offlineSeed);
    }
  }
  
  // Handle offline mode disable
  handleOfflineModeDisabled() {
    console.log('Connection restored, resuming multiplayer features');
    this.events.emit('showMessage', 'Connection restored! Syncing game state...');
    
    this.isOfflineMode = false;
    
    // Request a full state sync to ensure we're caught up
    this.time.delayedCall(300, () => {
      multiplayerService.requestFullSync();
    });
  }
  
  // Perform a comprehensive sync of the entire game state
  syncGameState() {
    if (!this.isMultiplayer || !multiplayerService.getConnectionState().connected) return;
    
    // Only the host should send full game state
    if (multiplayerService.isHost()) {
      const gameState = {
        seed: this.currentSeed,
        players: {},
        enemies: this.enemies,
        items: this.items
      };
      
      // Add local player
      if (this.player) {
        gameState.players[multiplayerService.getConnectionState().playerId] = {
          id: multiplayerService.getConnectionState().playerId,
          name: this.playerName,
          x: this.player.x,
          y: this.player.y,
          health: this.player.health,
          direction: this.player.direction,
          animation: this.player.anims.currentAnim ? this.player.anims.currentAnim.key : 'player_idle_down',
          isAttacking: this.player.isAttacking
        };
      }
      
      // Add other players
      if (this.remotePlayerManager && this.remotePlayerManager.players) {
        Object.keys(this.remotePlayerManager.players).forEach(playerId => {
          const remotePlayer = this.remotePlayerManager.players[playerId];
          gameState.players[playerId] = {
            id: playerId,
            name: remotePlayer.name || 'Player',
            x: remotePlayer.x,
            y: remotePlayer.y,
            health: remotePlayer.health || 100,
            direction: remotePlayer.direction || 'down',
            animation: remotePlayer.anims.currentAnim ? remotePlayer.anims.currentAnim.key : 'player_idle_down',
            isAttacking: remotePlayer.isAttacking || false
          };
        });
      }
      
      // Send the complete game state to the server
      multiplayerService.syncGameState(gameState);
    }
  }

  // Generate dungeon with optional seed for multiplayer sync
  generateDungeon(seed = null) {
    // Set a flag to track if we're retrying generation
    if (!this.generationAttempts) {
      this.generationAttempts = 0;
    }
    
    // Track attempts to prevent infinite loops if something goes wrong
    this.generationAttempts++;
    if (this.generationAttempts > 3) {
      console.error("Failed to generate dungeon after 3 attempts, using fallback");
      // Use simple fallback dungeon if failing repeatedly
      this.useFallbackDungeon();
      return;
    }
    
    try {
      // Generate the dungeon with increasing difficulty based on level
      this.dungeon = new DungeonGenerator({
        width: 50,
        height: 50,
        roomSizeRange: [7, 12],
        roomCountRange: [5 + this.levelNumber, 8 + this.levelNumber],
        corridorWidth: 2,
        trapDensity: 0.02 + (this.levelNumber * 0.01), // More traps in higher levels
        seed: seed // Use seed if provided for multiplayer sync
      }).generate();
      
      // Create tilemap from generated data
      this.createTilemap();
      
      // Create player in the first room's center
      const startRoom = this.dungeon.rooms[0];
      const playerX = startRoom.centerX * 16;
      const playerY = startRoom.centerY * 16;
      
      // Always create a new player at the start position
      this.player = new Player(this, playerX, playerY, 'character');
      
      // Ensure the setInvulnerable method exists on the player
      if (!this.player.setInvulnerable) {
        this.player.setInvulnerable = function(value) {
          this.isInvulnerable = value;
          // Visual indicator for invulnerability
          this.alpha = value ? 0.7 : 1;
        };
      }
      
      // Check if we have saved player data and restore it
      if (this.data.has('playerHealth')) {
        // Restore player stats from previous level
        this.player.health = this.data.get('playerHealth');
        this.player.maxHealth = this.data.get('playerMaxHealth');
        this.player.attackPower = this.data.get('playerAttackPower');
        this.player.gold = this.data.get('playerGold');
        
        // Parse inventory JSON string back to array
        try {
          const inventoryString = this.data.get('playerInventory');
          if (inventoryString) {
            this.player.inventory = JSON.parse(inventoryString);
          }
        } catch (error) {
          console.error('Error parsing player inventory:', error);
        }
        
        // Heal a bit between levels
        this.player.health = Math.min(this.player.health + 20, this.player.maxHealth);
      }
      
      // Set up enhanced camera system
      this.setupCamera();
      
      // Check if this is a mobile device using multiple detection methods
      const isMobile = this.detectMobileDevice();
      if (isMobile) {
        this.setupMobileControls();
        // Log that mobile controls have been set up
        console.log("Mobile device detected, mobile controls activated");
      }
      
      // Spawn enemies in rooms (except the first one)
      this.spawnEnemies();
      
      // Place items and treasures
      this.placeItems();
      
      // Place traps
      this.placeTraps();
      
      // Add dungeon exit
      this.placeExit();
      
      // Set up collisions
      this.safeAddCollider(this.player, this.collisionLayer);
      this.safeAddCollider(this.enemies, this.collisionLayer);
      this.safeAddCollider(this.enemies, this.enemies); // Enemies collide with each other
      this.safeAddCollider(this.player, this.enemies, this.handlePlayerEnemyCollision, null, this);
      
      // Set up item collection
      this.safeAddCollider(this.player, this.items, this.collectItem, null, this);
      
      // Set up trap activation
      this.safeAddCollider(this.player, this.traps, this.triggerTrap, null, this);
      
      // Set up exit interaction
      this.safeAddCollider(this.player, this.exit, this.goToNextLevel, null, this);
      
      // Create minimap
      this.setupMinimap();
      
      // If this is a multiplayer game, notify the server of our position
      if (this.isMultiplayer && multiplayerService.getConnectionState().connected) {
        multiplayerService.joinGame({
          name: this.playerName,
          x: this.player.x,
          y: this.player.y,
          direction: 'down',
          animation: 'player_idle_down',
          room: this.roomId,
          health: this.player.health
        });
      }
      
      // Reset generation attempts counter on success
      this.generationAttempts = 0;
    } catch (error) {
      console.error("Error generating dungeon:", error);
      // Try again with a different seed if we encounter an error
      this.generateDungeon(Math.random() * 10000);
    }
  }
  
  // New helper method to detect mobile devices using multiple techniques
  detectMobileDevice() {
    // Check using Phaser's built-in detection
    const phaserDetection = this.sys.game.device.input.touch;
    
    // Additional check using user agent (more reliable on some devices)
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    const uaDetection = /android|iPad|iPhone|iPod|webOS|BlackBerry|Windows Phone/i.test(userAgent);
    
    // Check screen dimensions (most phones are under 812px in portrait)
    const screenDetection = window.innerWidth <= 812 || window.innerHeight <= 812;
    
    // Log detection results
    console.log(`Mobile detection results: Phaser=${phaserDetection}, UserAgent=${uaDetection}, Screen=${screenDetection}`);
    
    // Return true if any method detects mobile
    return phaserDetection || uaDetection || screenDetection;
  }
  
  // Fallback dungeon for when generation fails
  useFallbackDungeon() {
    console.log("Using fallback dungeon");
    
    // Create a simple 3-room dungeon as fallback
    const fallbackRooms = [
      { x: 10, y: 10, width: 8, height: 8, centerX: 14, centerY: 14, type: 'normal' },
      { x: 22, y: 10, width: 8, height: 8, centerX: 26, centerY: 14, type: 'normal' },
      { x: 34, y: 10, width: 8, height: 8, centerX: 38, centerY: 14, type: 'boss' }
    ];
    
    const fallbackCorridors = [
      { startX: 14, startY: 14, endX: 26, endY: 14 },
      { startX: 26, startY: 14, endX: 38, endY: 14 }
    ];
    
    // Create minimal dungeon object with just the necessary properties
    this.dungeon = {
      width: 50,
      height: 50,
      rooms: fallbackRooms,
      corridors: fallbackCorridors,
      traps: []
    };
    
    // Continue with map creation as normal
    this.createTilemap();
    
    // Create player in first room center
    const playerX = fallbackRooms[0].centerX * 16;
    const playerY = fallbackRooms[0].centerY * 16;
    this.player = new Player(this, playerX, playerY, 'character');
    
    // Set up camera and other systems
    this.setupCamera();
    
    // Always set up mobile controls in fallback mode to ensure they're available
    this.setupMobileControls();
    
    this.spawnEnemies();
    this.placeItems();
    this.placeExit();
    
    // Set up basic collisions
    this.safeAddCollider(this.player, this.collisionLayer);
    
    // Create minimap
    this.setupMinimap();
    
    // Send message to user about using simplified map
    this.events.emit('showMessage', `Using simplified map due to generation issues`);
  }
  
  update(time, delta) {
    // Update player movement and animations
    if (this.player) {
      // Update joystick controls if active
      if (this.mobileControls.joystickActive && this.mobileControls.joystickPointer) {
        this.updateJoystickThumb(this.mobileControls.joystickPointer);
      }
      
      // Update player (handles movement and animations)
      this.player.update();
      
      // In multiplayer mode, send position updates to server at intervals
      if (this.isMultiplayer && multiplayerService.getConnectionState().connected && !this.isOfflineMode) {
        if (time - this.lastPositionUpdate > this.positionUpdateInterval) {
          this.lastPositionUpdate = time;
          
          // Only send updates if player has moved or changed animation
          if (this.player.body.velocity.x !== 0 || this.player.body.velocity.y !== 0 || 
              this.player.isAttacking || this.player.previousAnimation !== this.player.currentAnimation) {
            
            multiplayerService.updateMovement({
              x: this.player.x,
              y: this.player.y,
              direction: this.player.direction,
              animation: this.player.anims.currentAnim ? this.player.anims.currentAnim.key : 'player_idle_down'
            });
            
            // Store current animation for change detection
            this.player.previousAnimation = this.player.currentAnimation;
          }
        }
        
        // Perform full sync at intervals (only if we're the host)
        if (this.syncTimers && multiplayerService.isHost()) {
          // Quick sync for enemies and items
          if (time - this.syncTimers.lastQuickSync > this.syncTimers.quickSyncInterval) {
            this.syncTimers.lastQuickSync = time;
            
            // Sync enemies
            if (this.enemies && this.enemies.length > 0) {
              multiplayerService.syncEnemies(this.enemies);
            }
            
            // Sync items
            if (this.items && this.items.getChildren && this.items.getChildren().length > 0) {
              multiplayerService.syncItems(this.items);
            }
          }
          
          // Full comprehensive sync less frequently
          if (time - this.syncTimers.lastFullSync > this.syncTimers.fullSyncInterval) {
            this.syncTimers.lastFullSync = time;
            this.syncGameState();
          }
        }
      }
    }
    
    // Update enemies
    this.enemies.forEach(enemy => {
      if (enemy.active && !enemy.isDead) {
        enemy.update();
      }
    });
    
    // Handle camera zoom controls
    this.handleCameraControls();
  }
  
  // Clean up before scene shutdown
  shutdown() {
    // Clean up multiplayer resources when leaving
    if (this.isMultiplayer) {
      if (this.remotePlayerManager) {
        this.remotePlayerManager.destroy();
      }
    }
  }
  
  // Clean up when scene is destroyed
  destroy() {
    this.shutdown();
  }
  
  // In case of a room change (for level transitions)
  changeRoom(roomId) {
    if (this.isMultiplayer && multiplayerService.getConnectionState().connected) {
      multiplayerService.changeRoom(roomId);
      this.roomId = roomId;
    }
  }

  setupCamera() {
    // Set camera bounds
    this.cameras.main.setBounds(0, 0, this.map.widthInPixels, this.map.heightInPixels);
    
    // Enable smooth follow with lerp
    this.cameras.main.startFollow(
      this.player, 
      true,                      // Round pixels
      this.cameraSettings.lerp,  // X lerp (smoothing)
      this.cameraSettings.lerp   // Y lerp (smoothing)
    );
    
    // Set zoom level 
    this.cameras.main.setZoom(this.cameraSettings.zoomLevel);
    
    // Ensure the camera shows the full area without restricting player movement
    this.physics.world.setBounds(0, 0, this.map.widthInPixels, this.map.heightInPixels);
    
    // Fade in effect
    this.cameras.main.fadeIn(500);
    
    // Improve pixel art rendering
    this.cameras.main.roundPixels = true;
  }
  
  setupMinimap() {
    // Create a minimap in the top-right corner
    const minimapWidth = 200;
    const minimapHeight = 150;
    
    // Get the viewport dimensions
    const viewportWidth = this.cameras.main.width;
    const viewportHeight = this.cameras.main.height;
    
    // Create minimap camera
    this.minimap = this.cameras.add(
      viewportWidth - minimapWidth - 10, // X position (10px from right edge)
      10,                                // Y position (10px from top)
      minimapWidth,                      // Width
      minimapHeight                      // Height
    );
    
    // Configure minimap
    this.minimap.setBounds(0, 0, this.map.widthInPixels, this.map.heightInPixels);
    this.minimap.setZoom(0.1);  // Show a larger area
    this.minimap.setBackgroundColor(0x000000);
    this.minimap.setAlpha(0.7);
    this.minimap.startFollow(this.player);
    this.minimap.scrollX = 0;
    this.minimap.scrollY = 0;
    
    // Don't render UI elements on minimap
    // Fixed: Check if uiElements exists before ignoring it
    if (this.uiElements && Array.isArray(this.uiElements)) {
      this.minimap.ignore(this.uiElements);
    } else {
      // Create an empty container for UI elements if it doesn't exist
      this.uiElements = [];
    }
    
    // Add border to minimap
    this.minimapBorder = this.add.graphics()
      .setScrollFactor(0)
      .lineStyle(2, 0xffffff, 1)
      .strokeRect(
        viewportWidth - minimapWidth - 10,
        10,
        minimapWidth,
        minimapHeight
      );
    
    // Make sure minimap border is always on top
    this.minimapBorder.setDepth(100);
    
    // Add player indicator for the minimap
    this.playerIndicator = this.add.rectangle(
      this.player.x, 
      this.player.y, 
      6, 
      6, 
      0xff0000
    );
    this.playerIndicator.setDepth(101); // Above minimap
  }
  
  createTilemap() {
    // Create a blank tilemap
    this.map = this.make.tilemap({
      tileWidth: 16,
      tileHeight: 16,
      width: this.dungeon.width,
      height: this.dungeon.height
    });
    
    // Add tileset image - ensure we're using the right tileset image and properties
    const tileset = this.map.addTilesetImage('tiles', 'tiles', 16, 16, 0, 0);
    
    // Create layers
    const floorLayer = this.map.createBlankLayer('Floor', tileset);
    this.wallLayer = this.map.createBlankLayer('Walls', tileset);
    this.decorationLayer = this.map.createBlankLayer('Decorations', tileset);
    
    // Fill the entire map with empty tiles initially
    floorLayer.fill(-1);
    this.wallLayer.fill(-1);
    
    // Tile indices based on the exact arrangement in Dungeon_Tileset.png
    const TILES = {
      FLOOR: 6,      // Basic floor
      FLOOR_ALT: 7,  // Alternate floor for variety
      WALL: {
        TOP: 1,      // Top wall (facing down)
        RIGHT: 0,    // Right wall (facing left)
        BOTTOM: 3,   // Bottom wall (facing up) 
        LEFT: 2,     // Left wall (facing right)
        CORNER_TOP_RIGHT: 4,    // Top right outer corner
        CORNER_TOP_LEFT: 5,     // Top left outer corner
        CORNER_BOTTOM_RIGHT: 8, // Bottom right outer corner
        CORNER_BOTTOM_LEFT: 9,  // Bottom left outer corner
        INNER_TOP_RIGHT: 11,    // Inner top right corner
        INNER_TOP_LEFT: 12,     // Inner top left corner
        INNER_BOTTOM_RIGHT: 13, // Inner bottom right corner
        INNER_BOTTOM_LEFT: 14   // Inner bottom left corner
      },
      
      // Special floor tiles for different room types
      BOSS_FLOOR: 16,     // Floor for boss rooms
      TREASURE_FLOOR: 17, // Floor for treasure rooms
      CHALLENGE_FLOOR: 7, // Floor for challenge rooms
      SHOP_FLOOR: 8       // Floor for shop rooms
    };
    
    // Place floor tiles in rooms
    const rooms = this.dungeon.rooms;
    const corridors = this.dungeon.corridors;
    
    // Use the dungeon's seed to create consistent decoration
    // Create a simple seeded random function based on the dungeon seed
    let decorSeed = this.dungeon.seed || Math.floor(Math.random() * 1000000);
    const seededRandom = function() {
      decorSeed = (decorSeed * 9301 + 49297) % 233280;
      return decorSeed / 233280;
    };
    
    // Place floor tiles in rooms
    rooms.forEach(room => {
      // Get floor tile based on room type
      let floorTile = TILES.FLOOR;
      
      if (room.type === 'boss') {
        floorTile = TILES.BOSS_FLOOR;
      } else if (room.type === 'treasure') {
        floorTile = TILES.TREASURE_FLOOR;
      } else if (room.type === 'challenge') {
        floorTile = TILES.CHALLENGE_FLOOR;
      } else if (room.type === 'shop') {
        floorTile = TILES.SHOP_FLOOR;
      }
      
      // Fill room with floor tiles
      for (let x = room.x; x < room.x + room.width; x++) {
        for (let y = room.y; y < room.y + room.height; y++) {
          // Add some variety to floor tiles (10% chance for alternate tile)
          const tileToUse = seededRandom() > 0.1 ? floorTile : TILES.FLOOR_ALT;
          floorLayer.putTileAt(tileToUse, x, y);
        }
      }
    });
    
    // Place floor tiles in corridors
    corridors.forEach(corridor => {
      for (let x = Math.min(corridor.startX, corridor.endX); x <= Math.max(corridor.startX, corridor.endX); x++) {
        for (let y = Math.min(corridor.startY, corridor.endY); y <= Math.max(corridor.startY, corridor.endY); y++) {
          floorLayer.putTileAt(TILES.FLOOR, x, y);
        }
      }
    });
    
    // Create walls around floors
    // First, create a grid to track where floors are
    const wallGrid = Array(this.dungeon.height).fill().map(() => 
      Array(this.dungeon.width).fill(1)  // 1 = wall
    );
    
    // Mark floor areas in the grid as not walls (0)
    for (let y = 0; y < this.dungeon.height; y++) {
      for (let x = 0; x < this.dungeon.width; x++) {
        if (floorLayer.getTileAt(x, y) !== null) {
          wallGrid[y][x] = 0;
        }
      }
    }
    
    // Simple wall placement - place a basic wall tile next to any floor tile
    for (let y = 0; y < this.dungeon.height; y++) {
      for (let x = 0; x < this.dungeon.width; x++) {
        if (wallGrid[y][x] === 1) {
          // Check if this wall is adjacent to a floor
          const hasFloorNeighbor = 
            (y > 0 && wallGrid[y-1][x] === 0) ||
            (y < this.dungeon.height - 1 && wallGrid[y+1][x] === 0) ||
            (x > 0 && wallGrid[y][x-1] === 0) ||
            (x < this.dungeon.width - 1 && wallGrid[y][x+1] === 0) ||
            (y > 0 && x > 0 && wallGrid[y-1][x-1] === 0) ||
            (y > 0 && x < this.dungeon.width - 1 && wallGrid[y-1][x+1] === 0) ||
            (y < this.dungeon.height - 1 && x > 0 && wallGrid[y+1][x-1] === 0) ||
            (y < this.dungeon.height - 1 && x < this.dungeon.width - 1 && wallGrid[y+1][x+1] === 0);
          
          if (hasFloorNeighbor) {
            // First get all neighbor information
            const floorAbove = y > 0 && wallGrid[y-1][x] === 0;
            const floorBelow = y < this.dungeon.height - 1 && wallGrid[y+1][x] === 0;
            const floorLeft = x > 0 && wallGrid[y][x-1] === 0;
            const floorRight = x < this.dungeon.width - 1 && wallGrid[y][x+1] === 0;
            
            // Diagonal floor tiles
            const floorTopLeft = y > 0 && x > 0 && wallGrid[y-1][x-1] === 0;
            const floorTopRight = y > 0 && x < this.dungeon.width - 1 && wallGrid[y-1][x+1] === 0;
            const floorBottomLeft = y < this.dungeon.height - 1 && x > 0 && wallGrid[y+1][x-1] === 0;
            const floorBottomRight = y < this.dungeon.height - 1 && x < this.dungeon.width - 1 && wallGrid[y+1][x+1] === 0;

            // Define each possible wall configuration separately
            let tileToUse = TILES.WALL.TOP; // Default wall tile
            
            // Single floor neighbors
            if (floorBelow && !floorAbove && !floorLeft && !floorRight) {
              tileToUse = TILES.WALL.TOP;
            } 
            else if (floorAbove && !floorBelow && !floorLeft && !floorRight) {
              tileToUse = TILES.WALL.BOTTOM;
            }
            else if (floorLeft && !floorRight && !floorAbove && !floorBelow) {
              tileToUse = TILES.WALL.RIGHT;
            }
            else if (floorRight && !floorLeft && !floorAbove && !floorBelow) {
              tileToUse = TILES.WALL.LEFT;
            }
            
            // Two adjacent floor neighbors - straight walls
            else if (floorAbove && floorBelow && !floorLeft && !floorRight) {
              tileToUse = TILES.WALL.LEFT;  // Vertical wall
            }
            else if (floorLeft && floorRight && !floorAbove && !floorBelow) {
              tileToUse = TILES.WALL.TOP;   // Horizontal wall
            }
            
            // Two floor neighbors - outer corners
            // Corner cases need careful detection for proper connections
            else if (floorBelow && floorRight && !floorAbove && !floorLeft) {
              // For outer corner, we need to check if there's a floor at the diagonal
              if (!floorBottomRight) {
                tileToUse = TILES.WALL.CORNER_TOP_LEFT;
              } else {
                // If there is a floor at diagonal, we need a different tile based on context
                // Check surrounding tiles to determine best fit
                tileToUse = TILES.WALL.TOP; // Default to horizontal wall if uncertain
              }
            }
            else if (floorBelow && floorLeft && !floorAbove && !floorRight) {
              if (!floorBottomLeft) {
                tileToUse = TILES.WALL.CORNER_TOP_RIGHT;
              } else {
                tileToUse = TILES.WALL.TOP; // Default to horizontal wall if uncertain
              }
            }
            else if (floorAbove && floorRight && !floorBelow && !floorLeft) {
              if (!floorTopRight) {
                tileToUse = TILES.WALL.CORNER_BOTTOM_LEFT;
              } else {
                tileToUse = TILES.WALL.LEFT; // Default to vertical wall if uncertain
              }
            }
            else if (floorAbove && floorLeft && !floorBelow && !floorRight) {
              if (!floorTopLeft) {
                tileToUse = TILES.WALL.CORNER_BOTTOM_RIGHT;
              } else {
                tileToUse = TILES.WALL.RIGHT; // Default to vertical wall if uncertain
              }
            }
            
            // Inner corners - exact pattern matching for reliable detection
            else if (!floorAbove && !floorRight && floorTopRight) {
              tileToUse = TILES.WALL.INNER_BOTTOM_LEFT;
            }
            else if (!floorAbove && !floorLeft && floorTopLeft) {
              tileToUse = TILES.WALL.INNER_BOTTOM_RIGHT;
            }
            else if (!floorBelow && !floorRight && floorBottomRight) {
              tileToUse = TILES.WALL.INNER_TOP_LEFT;
            }
            else if (!floorBelow && !floorLeft && floorBottomLeft) {
              tileToUse = TILES.WALL.INNER_TOP_RIGHT;
            }
            
            // Three floor neighbors - T-junctions
            else if (floorLeft && floorRight && floorBelow && !floorAbove) {
                tileToUse = TILES.WALL.TOP;
            }
            else if (floorLeft && floorRight && floorAbove && !floorBelow) {
                tileToUse = TILES.WALL.BOTTOM;
            }
            else if (floorAbove && floorBelow && floorRight && !floorLeft) {
                tileToUse = TILES.WALL.LEFT;
            }
            else if (floorAbove && floorBelow && floorLeft && !floorRight) {
                tileToUse = TILES.WALL.RIGHT;
            }
            
            // Diagonal-only connections (rare case)
            else if (!floorAbove && !floorBelow && !floorLeft && !floorRight) {
              // If only diagonal floors, use inner corner that points away from floor
              if (floorTopLeft && !floorTopRight && !floorBottomLeft && !floorBottomRight) {
                tileToUse = TILES.WALL.INNER_BOTTOM_RIGHT;
              }
              else if (!floorTopLeft && floorTopRight && !floorBottomLeft && !floorBottomRight) {
                tileToUse = TILES.WALL.INNER_BOTTOM_LEFT;
              }
              else if (!floorTopLeft && !floorTopRight && floorBottomLeft && !floorBottomRight) {
                tileToUse = TILES.WALL.INNER_TOP_RIGHT;
              }
              else if (!floorTopLeft && !floorTopRight && !floorBottomLeft && floorBottomRight) {
                tileToUse = TILES.WALL.INNER_TOP_LEFT;
              }
              else {
                tileToUse = TILES.WALL.TOP; // Default if multiple diagonal floors
              }
            }
            
            // Four floor neighbors - surrounded wall
            else if (floorAbove && floorBelow && floorLeft && floorRight) {
              // Choose based on diagonal floors if any are missing
              if (!floorTopLeft) {
                tileToUse = TILES.WALL.INNER_BOTTOM_RIGHT;
              }
              else if (!floorTopRight) {
                tileToUse = TILES.WALL.INNER_BOTTOM_LEFT;
              }
              else if (!floorBottomLeft) {
                tileToUse = TILES.WALL.INNER_TOP_RIGHT;
              }
              else if (!floorBottomRight) {
                tileToUse = TILES.WALL.INNER_TOP_LEFT;
              }
              else {
                tileToUse = TILES.WALL.TOP; // Completely surrounded, use default
              }
            }
            
            // Default fallback in case of odd configurations
            else {
              // Check for the most important direction and use that
              if (floorBelow) {
                tileToUse = TILES.WALL.TOP;
              } else if (floorRight) {
                tileToUse = TILES.WALL.LEFT;
              } else if (floorLeft) {
                tileToUse = TILES.WALL.RIGHT;
              } else if (floorAbove) {
                tileToUse = TILES.WALL.BOTTOM;
              }
            }

            this.wallLayer.putTileAt(tileToUse, x, y);
          }
        }
      }
    }
    
    // Add some decorations to rooms
    rooms.forEach(room => {
      // Skip decorations for very small rooms
      if (room.width <= 3 || room.height <= 3) return;
      
      // Add decorations with some probability (avoiding edges)
      for (let x = room.x + 1; x < room.x + room.width - 1; x++) {
        for (let y = room.y + 1; y < room.y + room.height - 1; y++) {
          if (seededRandom() > 0.95) {
            // Random decorative object - these are all just example indices
            let decorTile = 16 + Math.floor(seededRandom() * 4);
            
            if (room.type === 'boss') {
              decorTile = 20 + Math.floor(seededRandom() * 3);
            } else if (room.type === 'treasure') {
              decorTile = 23 + Math.floor(seededRandom() * 3);
            }
            
            this.decorationLayer.putTileAt(decorTile, x, y);
          }
        }
      }
    });
    
    // Set collision on wall layer
    this.wallLayer.setCollisionByExclusion([-1]);
    this.collisionLayer = this.wallLayer;
    
    // Set depth ordering
    floorLayer.setDepth(0);
    this.decorationLayer.setDepth(1);
    this.wallLayer.setDepth(5);
  }
  
  spawnEnemies() {
    this.enemies = [];
    
    // Skip the first room (player spawn)
    for (let i = 1; i < this.dungeon.rooms.length; i++) {
      const room = this.dungeon.rooms[i];
      
      // Determine number of enemies based on room size and type
      let enemyCount = Math.floor(Math.random() * 2) + 1; // 1-2 enemies per normal room
      
      if (room.type === 'challenge') {
        enemyCount = Math.floor(Math.random() * 2) + 3; // 3-4 enemies for challenge rooms
      } else if (room.type === 'boss' && i === this.dungeon.rooms.length - 1) {
        enemyCount = 1; // 1 boss enemy for boss room
      }
      
      // Safety check - ensure we don't spawn more enemies than can fit in the room
      const maxEnemiesForRoom = Math.max(1, Math.floor((room.width - 2) * (room.height - 2) / 4));
      enemyCount = Math.min(enemyCount, maxEnemiesForRoom);

      for (let j = 0; j < enemyCount; j++) {
        // Calculate a position within the room with safer boundaries
        // Leave a 1-tile buffer from the walls to prevent spawning in walls
        let x, y;
        let validPosition = false;
        let attempts = 0;
        const maxAttempts = 10; // Limit attempts to find a valid position
        
        while (!validPosition && attempts < maxAttempts) {
          // Use a buffer of 2 tiles from the edges for safer positioning
          const minX = room.x + 2;
          const maxX = room.x + room.width - 2;
          const minY = room.y + 2;
          const maxY = room.y + room.height - 2;
          
          // Generate potential position
          const tileX = Math.floor(minX + Math.random() * (maxX - minX));
          const tileY = Math.floor(minY + Math.random() * (maxY - minY));
          
          // Convert to pixel coordinates (center of tile)
          x = tileX * 16 + 8;
          y = tileY * 16 + 8;
          
          // Check if this position is valid (not colliding with walls)
          validPosition = true; // Assume valid unless proven otherwise
          
          // If we have access to the collision layer, check if the tile is walkable
          if (this.collisionLayer) {
            const tile = this.collisionLayer.getTileAtWorldXY(x, y);
            if (tile && tile.collides) {
              validPosition = false;
            }
          }
          
          // Avoid spawning too close to other enemies
          if (validPosition && this.enemies.length > 0) {
            for (const otherEnemy of this.enemies) {
              const dist = Phaser.Math.Distance.Between(x, y, otherEnemy.x, otherEnemy.y);
              if (dist < 32) { // Minimum 2 tiles distance between enemies
                validPosition = false;
                break;
              }
            }
          }
          
          attempts++;
        }
        
        // If we couldn't find a valid position after max attempts, skip this enemy
        if (!validPosition) {
          console.warn(`Couldn't find valid position for enemy in room ${i} after ${maxAttempts} attempts`);
          continue;
        }
        
        // Determine enemy type
        let enemyType = 'skeleton';
        let texture = 'skeleton1_idle';
        
        // Last room has boss, some rooms have vampires
        if (room.type === 'boss' && j === 0) {
          enemyType = 'boss';
          texture = 'vampire_idle';
        } else if (room.type === 'challenge' || Math.random() > 0.7) {
          enemyType = 'vampire';
          texture = 'vampire_idle';
        }
        
        // Create an enemy at this position
        const enemy = new Enemy(this, x, y, texture, enemyType);
        this.enemies.push(enemy);
      }
    }
  }
  
  placeItems() {
    this.items = this.physics.add.group();
    
    // Place items in rooms based on room type
    this.dungeon.rooms.forEach((room, index) => {
      // Skip the first room (player spawn)
      if (index === 0) return;
      
      let chestChance = 0.3; // 30% for normal rooms
      
      if (room.type === 'treasure') {
        chestChance = 1.0; // 100% for treasure rooms
      } else if (room.type === 'shop') {
        chestChance = 0.7; // 70% for shop rooms
      }
      
      // Place chest based on chance
      if (Math.random() < chestChance) {
        const x = Math.floor(room.x + 1 + Math.random() * (room.width - 2)) * 16;
        const y = Math.floor(room.y + 1 + Math.random() * (room.height - 2)) * 16;
        
        const chest = this.physics.add.sprite(x, y, 'chest', 0);
        chest.setImmovable(true);
        chest.itemType = 'chest';
        chest.isOpen = false;
        
        // Treasure rooms have better loot
        chest.quality = room.type === 'treasure' ? 'high' : 'normal';
        
        this.items.add(chest);
      }
      
      // Add gold coins in some rooms
      if (Math.random() < 0.4 && room.type !== 'boss') {
        const coinCount = Phaser.Math.Between(1, 3);
        
        for (let i = 0; i < coinCount; i++) {
          const x = Math.floor(room.x + 1 + Math.random() * (room.width - 2)) * 16;
          const y = Math.floor(room.y + 1 + Math.random() * (room.height - 2)) * 16;
          
          const coin = this.physics.add.sprite(x, y, 'coin', 0);
          coin.anims.play('coin_spin', true);
          coin.itemType = 'coin';
          coin.value = Phaser.Math.Between(1, 5);
          
          this.items.add(coin);
        }
      }
      
      // Add health potions rarely
      if (Math.random() < 0.2 && room.type !== 'boss') {
        const x = Math.floor(room.x + 1 + Math.random() * (room.width - 2)) * 16;
        const y = Math.floor(room.y + 1 + Math.random() * (room.height - 2)) * 16;
        
        const potion = this.physics.add.sprite(x, y, 'health_potion', 0);
        potion.itemType = 'health_potion';
        this.items.add(potion);
      }
    });
  }
  
  placeTraps() {
    this.traps = this.physics.add.group();
    
    // Place traps from dungeon generation
    if (this.dungeon.traps && this.dungeon.traps.length > 0) {
      this.dungeon.traps.forEach(trapData => {
        // Only create visible traps for now (invisible ones could be added with special effects)
        if (trapData.visible) {
          const x = trapData.x * 16 + 8;
          const y = trapData.y * 16 + 8;
          
          const trap = this.physics.add.sprite(x, y, 'trap', 0);
          trap.trapType = trapData.type;
          trap.damage = trapData.type === 'poison' ? 5 : 10; // Spike traps do more damage
          trap.activated = false;
          
          this.traps.add(trap);
        }
      });
    }
  }
  
  placeExit() {
    // Place exit in the last room (boss room)
    const lastRoom = this.dungeon.rooms[this.dungeon.rooms.length - 1];
    const exitX = lastRoom.centerX * 16;
    const exitY = lastRoom.centerY * 16;
    
    // Create exit sprite using a valid frame (changing from invalid tiles frame 10)
    // Use the first frame of health_potion as a temporary exit marker
    this.exit = this.physics.add.sprite(exitX, exitY, 'health_potion', 0);
    this.exit.setScale(1.5);
    this.exit.depth = -1; // Render below other sprites
    
    // Add a pulsing effect to make it more visible
    this.tweens.add({
      targets: this.exit,
      alpha: 0.6,
      duration: 1000,
      yoyo: true,
      repeat: -1
    });
  }
  
  handlePlayerEnemyCollision(player, enemy) {
    // If the player is attacking, damage the enemy
    if (player.isAttacking) {
      enemy.takeDamage(player.attackPower);
      
      // Knockback effect
      const knockbackDirection = new Phaser.Math.Vector2(enemy.x - player.x, enemy.y - player.y).normalize();
      enemy.body.velocity.x = knockbackDirection.x * 200;
      enemy.body.velocity.y = knockbackDirection.y * 200;
      
      // Allow time for knockback before normal movement resumes
      this.time.delayedCall(200, () => {
        if (enemy.active) { // Check if enemy still exists
          enemy.body.velocity.x = 0;
          enemy.body.velocity.y = 0;
        }
      });
    }
    // If the enemy is active, damage the player
    else if (!enemy.isDead && !player.isInvulnerable) {
      player.takeDamage(enemy.attackPower);
      
      // Use enhanced screen shake for damage
      this.screenShake(0.02, 250);
      
      // Make player invulnerable for a short time
      // Set property directly if method doesn't work
      player.isInvulnerable = true;
      player.alpha = 0.7; // Visual indicator for invulnerability
      
      this.time.delayedCall(1000, () => {
        if (player.active) { // Check if player still exists
          // Reset invulnerability
          player.isInvulnerable = false;
          player.alpha = 1;
        }
      });
      
      // Knockback effect on player
      const knockbackDirection = new Phaser.Math.Vector2(player.x - enemy.x, player.y - enemy.y).normalize();
      player.body.velocity.x = knockbackDirection.x * 150;
      player.body.velocity.y = knockbackDirection.y * 150;
      
      // Allow time for knockback before normal movement resumes
      this.time.delayedCall(200, () => {
        if (player.active) { // Check if player still exists
          player.body.velocity.x = 0;
          player.body.velocity.y = 0;
        }
      });
    }
  }
  
  collectItem(player, item) {
    if (item.itemType === 'chest' && !item.isOpen) {
      // Play chest opening animation
      item.isOpen = true;
      item.anims.play('chest_open');
      
      // Generate random loot based on chest quality
      const isHighQuality = item.quality === 'high';
      const lootType = Math.random();
      let lootMessage;
      
      if (lootType < 0.5) {
        // Gold
        const goldAmount = Phaser.Math.Between(isHighQuality ? 10 : 5, isHighQuality ? 30 : 15);
        player.addGold(goldAmount);
        lootMessage = `Found ${goldAmount} gold!`;
      } else if (lootType < 0.8) {
        // Health potion
        player.addToInventory('health_potion');
        
        if (isHighQuality && Math.random() < 0.5) {
          player.addToInventory('health_potion'); // Extra potion for high-quality chests
          lootMessage = 'Found 2 health potions!';
        } else {
          lootMessage = 'Found a health potion!';
        }
      } else {
        // Weapon upgrade
        const upgradeAmount = isHighQuality ? 2 : 1;
        player.attackPower += upgradeAmount;
        lootMessage = `Found a weapon upgrade! (+${upgradeAmount} attack)`;
      }
      
      // Notify the UI scene
      this.events.emit('showMessage', lootMessage);
      
      // In multiplayer, notify other clients about this item change
      if (this.isMultiplayer && multiplayerService.getConnectionState().connected) {
        // Make sure item has an ID
        const itemId = item.id || item.itemId || `item_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        if (!item.id && !item.itemId) {
          item.id = itemId;
          item.itemId = itemId;
        }
        
        // Notify server about the chest being opened
        multiplayerService.updateItem({
          id: itemId,
          type: 'chest',
          x: item.x,
          y: item.y,
          isOpen: true,
          collected: false,
          quality: item.quality || 'normal'
        });
      }
      
    } else if (item.itemType === 'coin') {
      // Collect gold coin
      player.addGold(item.value);
      
      // Synchronize with server in multiplayer
      if (this.isMultiplayer && multiplayerService.getConnectionState().connected) {
        const itemId = item.id || item.itemId || `coin_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        multiplayerService.pickupItem({
          id: itemId,
          type: 'coin',
          collected: true
        });
      }
      
      // Destroy the coin
      item.destroy();
      
    } else if (item.itemType === 'health_potion') {
      // Collect health potion
      player.addToInventory('health_potion');
      this.events.emit('showMessage', 'Picked up a health potion!');
      
      // Synchronize with server in multiplayer
      if (this.isMultiplayer && multiplayerService.getConnectionState().connected) {
        const itemId = item.id || item.itemId || `potion_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        multiplayerService.pickupItem({
          id: itemId,
          type: 'health_potion',
          collected: true
        });
      }
      
      // Destroy the potion
      item.destroy();
    }
  }
  
  triggerTrap(player, trap) {
    if (!trap.activated) {
      trap.activated = true;
      
      // Play trap animation
      trap.anims.play('trap_activate');
      
      // Apply damage to player
      player.takeDamage(trap.damage);
      
      // Use enhanced screen shake for trap effect
      this.screenShake(0.015, 200);
      
      // Show message based on trap type
      const trapName = trap.trapType === 'poison' ? 'poison trap' : 'spike trap';
      this.events.emit('showMessage', `Triggered a ${trapName}! (-${trap.damage} health)`);
      
      // Additional effects based on trap type
      if (trap.trapType === 'poison') {
        // Apply poison effect (damage over time)
        player.setTint(0x00ff00); // Green tint for poison
        
        let poisonTicks = 3;
        const poisonTimer = this.time.addEvent({
          delay: 1000,
          callback: () => {
            if (player.active) {
              player.takeDamage(2);
              poisonTicks--;
              
              if (poisonTicks <= 0) {
                player.clearTint();
                poisonTimer.remove();
              }
            }
          },
          repeat: poisonTicks - 1
        });
      }
      
      // Remove trap after a delay
      this.time.delayedCall(1000, () => {
        if (trap.active) {
          trap.destroy();
        }
      });
    }
  }
  
  goToNextLevel(player, exit) {
    // Prevent multiple calls to this function
    if (this.isTransitioning) return;
    
    // Only allow exit if all enemies in the last room are defeated
    const lastRoom = this.dungeon.rooms[this.dungeon.rooms.length - 1];
    const enemiesInLastRoom = this.enemies.filter(enemy => {
      return enemy.active && !enemy.isDead && 
             enemy.x >= lastRoom.x * 16 && enemy.x <= (lastRoom.x + lastRoom.width) * 16 &&
             enemy.y >= lastRoom.y * 16 && enemy.y <= (lastRoom.y + lastRoom.height) * 16;
    });
    
    if (enemiesInLastRoom.length === 0) {
      // Set transitioning flag to prevent multiple calls
      this.isTransitioning = true;
      
      // Increment level number
      this.levelNumber++;
      
      // Show level completion message
      this.events.emit('showMessage', `Level ${this.levelNumber - 1} complete! Going deeper...`);
      
      // Add some rewards between levels
      player.addGold(this.levelNumber * 10); // Gold reward increases with level
      
      // Save player data in data manager for persistence
      this.data.set('playerHealth', player.health);
      this.data.set('playerMaxHealth', player.maxHealth);
      this.data.set('playerAttackPower', player.attackPower);
      this.data.set('playerGold', player.gold);
      this.data.set('playerInventory', JSON.stringify(player.inventory));
      this.data.set('levelNumber', this.levelNumber);
      
      // Use enhanced transition effect
      this.cameras.main.fadeOut(500, 0, 0, 0);
      
      // Wait for fade out before restarting
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        // Stop the current scene and restart it
        this.scene.restart();
      });
    } else {
      this.events.emit('showMessage', 'Defeat all enemies in this room to proceed!');
    }
  }

  setupMobileControls() {
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;
    
    // Create virtual joystick for movement
    this.mobileControls.enabled = true;
    
    // Adjust joystick size and position for small screens
    const isSmallScreen = width < 425;
    
    // Calculate sizes based on screen dimensions
    const buttonRadius = isSmallScreen ? 35 : 45;
    const margin = isSmallScreen ? 15 : 20;
    
    // Position joystick at the bottom left
    const joystickX = buttonRadius + margin;
    const joystickY = height - buttonRadius - margin;
    
    // Create joystick container with base and thumb
    const joystickBase = this.add.circle(joystickX, joystickY, buttonRadius, 0x000000, 0.7);
    const joystickThumb = this.add.circle(joystickX, joystickY, buttonRadius * 0.5, 0x4444ff, 0.9);
    
    // Make joystick elements stay fixed to the camera (UI elements)
    joystickBase.setScrollFactor(0);
    joystickThumb.setScrollFactor(0);
    
    // Increase depth values to ensure controls appear on top of everything
    joystickBase.setDepth(1000);
    joystickThumb.setDepth(1001);
    
    // Add a border to the joystick for better visibility
    const joystickBorder = this.add.circle(joystickX, joystickY, buttonRadius + 2, 0xffffff, 0.3);
    joystickBorder.setScrollFactor(0);
    joystickBorder.setDepth(999);
    
    // Position attack button in the bottom right
    const attackButtonX = width - buttonRadius - margin;
    const attackButtonY = height - buttonRadius - margin;
    
    // Add attack button
    const attackButton = this.add.circle(attackButtonX, attackButtonY, buttonRadius, 0xdd0000, 0.7);
    const attackButtonText = this.add.text(attackButtonX, attackButtonY, 'ATTACK', {
      fontSize: isSmallScreen ? '12px' : '16px',
      fontFamily: 'Arial',
      color: '#ffffff'
    }).setOrigin(0.5);
    
    // Make attack button stay fixed on screen
    attackButton.setScrollFactor(0);
    attackButtonText.setScrollFactor(0);
    attackButton.setDepth(1000);
    attackButtonText.setDepth(1001);
    
    // Add audio context unlocking
    this.input.on('pointerdown', () => {
      // Attempt to resume the audio context when user interacts
      if (this.sound && this.sound.context && this.sound.context.state === 'suspended') {
        this.sound.context.resume();
      }
    });
    
    // Store references
    this.mobileControls.joystickBase = joystickBase;
    this.mobileControls.joystickThumb = joystickThumb;
    this.mobileControls.joystickBorder = joystickBorder;
    this.mobileControls.attackButton = attackButton;
    this.mobileControls.attackButtonText = attackButtonText;
    this.mobileControls.joystickVector = { x: 0, y: 0 };
    this.mobileControls.joystickRadius = buttonRadius;
    
    // Add all UI elements to a container to make them easier to manage
    this.uiElements = this.uiElements || [];
    this.uiElements.push(
      joystickBase,
      joystickThumb, 
      joystickBorder,
      attackButton,
      attackButtonText
    );
    
    // Set up input handler for the joystick
    this.input.on('pointerdown', (pointer) => {
      // Check if this touch is in the joystick area
      if (!this.mobileControls.joystickBase) return;
      
      const joystickX = this.mobileControls.joystickBase.x;
      const joystickY = this.mobileControls.joystickBase.y;
      const distX = pointer.x - joystickX;
      const distY = pointer.y - joystickY;
      const dist = Math.sqrt(distX * distX + distY * distY);
      
      // Make joystick activation radius larger on small screens for better user experience
      const activationRadius = isSmallScreen ? 
        this.mobileControls.joystickRadius * 2.5 : 
        this.mobileControls.joystickRadius * 2;
      
      if (dist <= activationRadius) {
        // This is a joystick touch
        this.mobileControls.joystickPointer = pointer;
        this.mobileControls.joystickActive = true;
        
        // Move the thumb to touch position (constrained to the base radius)
        this.updateJoystickThumb(pointer);
      } else if (pointer.x > width/2) {
        // Check if touch was on the attack button or right side of screen
        const distToAttackButton = Phaser.Math.Distance.Between(
          pointer.x, 
          pointer.y, 
          attackButtonX, 
          attackButtonY
        );
        
        if (distToAttackButton < buttonRadius || pointer.x > width/2) {
          // Attack button was pressed or right side of screen was tapped
          if (this.player && this.player.canAttack()) {
            this.handleTouchAttack(pointer);
          }
        }
      }
    });
    
    // Add pointer up and pointer move handlers
    this.input.on('pointerup', (pointer) => {
      if (pointer.id === this.mobileControls.joystickPointer?.id) {
        this.resetJoystick();
      }
    });
    
    this.input.on('pointermove', (pointer) => {
      if (this.mobileControls.joystickActive && 
          pointer.id === this.mobileControls.joystickPointer?.id) {
        this.updateJoystickThumb(pointer);
      }
    });
    
    // Make the joystick inactive when pointer leaves game
    this.input.on('pointerout', (pointer) => {
      if (pointer.id === this.mobileControls.joystickPointer?.id) {
        this.resetJoystick();
      }
    });
  }
  
  updateJoystickThumb(pointer) {
    if (!this.mobileControls.joystickBase || !this.mobileControls.joystickThumb) {
      return;
    }
    
    const baseX = this.mobileControls.joystickBase.x;
    const baseY = this.mobileControls.joystickBase.y; // Fixed: Using joystickBase.y instead of joystickThumb.y
    
    // Calculate joystick direction vector
    let deltaX = pointer.x - baseX;
    let deltaY = pointer.y - baseY;
    
    // Normalize and limit to the joystick radius
    const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    if (length > this.mobileControls.joystickRadius) {
      deltaX = deltaX * (this.mobileControls.joystickRadius / length);
      deltaY = deltaY * (this.mobileControls.joystickRadius / length);
    }
    
    // Update thumb position
    this.mobileControls.joystickThumb.x = baseX + deltaX;
    this.mobileControls.joystickThumb.y = baseY + deltaY;
    
    // Store the normalized direction vector for player movement
    if (length > 0) {
      this.mobileControls.joystickVector = { 
        x: deltaX / this.mobileControls.joystickRadius, 
        y: deltaY / this.mobileControls.joystickRadius 
      };
    } else {
      this.mobileControls.joystickVector = { x: 0, y: 0 };
    }
    
    // Update player movement direction based on joystick
    this.updatePlayerFromJoystick();
  }
  
  resetJoystick() {
    // Reset thumb position
    if (this.mobileControls.joystickBase && this.mobileControls.joystickThumb) {
      this.mobileControls.joystickThumb.x = this.mobileControls.joystickBase.x;
      this.mobileControls.joystickThumb.y = this.mobileControls.joystickBase.y;
    }
    
    // Reset control state
    this.mobileControls.joystickActive = false;
    this.mobileControls.joystickPointer = null;
    this.mobileControls.joystickVector = { x: 0, y: 0 };
    
    // Stop player movement
    if (this.player) {
      this.player.mobileInputs = {
        up: false,
        down: false,
        left: false,
        right: false
      };
    }
  }
  
  updatePlayerFromJoystick() {
    if (!this.player || !this.mobileControls.joystickActive) {
      return;
    }
    
    const vector = this.mobileControls.joystickVector;
    
    // Convert continuous vector to discrete inputs for compatibility with existing Player code
    this.player.mobileInputs = {
      up: vector.y < -0.3,
      down: vector.y > 0.3,
      left: vector.x < -0.3,
      right: vector.x > 0.3
    };
    
    // Also store the raw vector for smoother, analog-style controls
    this.player.mobileVector = { x: vector.x, y: vector.y };
  }
  
  handleTouchAttack(pointer) {
    if (!this.player) return;
    
    // Convert screen position to world position for proper targeting
    const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    
    // Calculate direction from player to touch point
    const dirX = worldPoint.x - this.player.x;
    const dirY = worldPoint.y - this.player.y;
    
    // Determine which direction is dominant
    if (Math.abs(dirX) > Math.abs(dirY)) {
      // Horizontal direction is dominant
      this.player.direction = dirX > 0 ? 'right' : 'left';
    } else {
      // Vertical direction is dominant
      this.player.direction = dirY > 0 ? 'down' : 'up';
    }
    
    // Trigger attack
    this.player.attack();
    
    // Store attack target for reference (could be used for projectile aiming)
    this.touchTarget.set(worldPoint.x, worldPoint.y);
  }
  
  handleCameraControls() {
    // Camera zoom in/out with keyboard
    if (Phaser.Input.Keyboard.JustDown(this.keys.zoomIn)) {
      this.zoomCamera(0.1);
    }
    else if (Phaser.Input.Keyboard.JustDown(this.keys.zoomOut)) {
      this.zoomCamera(-0.1);
    }
    else if (Phaser.Input.Keyboard.JustDown(this.keys.resetZoom)) {
      this.cameras.main.setZoom(this.cameraSettings.zoomLevel);
    }
    
    // Update player indicator on minimap (if used)
    if (this.playerIndicator && this.minimap) {
      this.playerIndicator.setPosition(this.player.x, this.player.y);
    }
  }
  
  zoomCamera(amount) {
    // Calculate new zoom level
    let newZoom = this.cameras.main.zoom + amount;
    
    // Clamp zoom to min/max values
    newZoom = Phaser.Math.Clamp(
      newZoom, 
      this.cameraSettings.minZoom, 
      this.cameraSettings.maxZoom
    );
    
    // Apply zoom with smooth transition
    this.tweens.add({
      targets: this.cameras.main,
      zoom: newZoom,
      duration: 300,
      ease: 'Power2'
    });
  }
  
  // Enhanced screen shake with parameters for intensity and duration
  screenShake(intensity = null, duration = 200) {
    const shakeIntensity = intensity || this.cameraSettings.shakeIntensity;
    this.cameras.main.shake(duration, shakeIntensity);
  }
  
  // Focus camera on specific coordinates with optional zoom
  focusCamera(x, y, zoom = null, duration = 1000) {
    // Stop following the player temporarily
    this.cameras.main.stopFollow();
    
    // Create camera pan tween
    this.tweens.add({
      targets: this.cameras.main,
      scrollX: x - (this.cameras.main.width / 2),
      scrollY: y - (this.cameras.main.height / 2),
      zoom: zoom || this.cameras.main.zoom,
      duration: duration,
      ease: 'Power2',
      onComplete: () => {
        // Resume following player after pan completes
        this.cameras.main.startFollow(
          this.player, 
          true,
          this.cameraSettings.lerp,
          this.cameraSettings.lerp
        );
      }
    });
  }
  
  // Use this to flash the screen for damage, healing, etc.
  flashCamera(color = 0xff0000, duration = 100) {
    this.cameras.main.flash(duration, color[0], color[1], color[2]);
  }

  // Focus on a specific room
  focusOnRoom(room, duration = 1000) {
    const roomCenterX = (room.x + room.width / 2) * 16;
    const roomCenterY = (room.y + room.height / 2) * 16;
    this.focusCamera(roomCenterX, roomCenterY, 1, duration);
  }

  // Safe method for adding colliders with collision layer validation
  safeAddCollider(object1, object2, callback = null, processCallback = null, context = null) {
    // Check if both objects exist and are valid
    if (!object1 || !object2) {
      console.warn('Attempted to add collider with undefined objects');
      
      // Store pending collider if collision layer isn't ready yet
      if (this.collisionCheckSafety && !this.collisionCheckSafety.isReady) {
        this.collisionCheckSafety.pendingColliders.push({
          object1, object2, callback, processCallback, context
        });
        return null; // Return null instead of an invalid collider
      }
      return null;
    }
    
    // Additional check specifically for tilemaps to prevent the tileWidth error
    if ((object1 === this.collisionLayer || object2 === this.collisionLayer) && 
        (!this.map || !this.map.tileWidth)) {
      console.warn('Attempted to add collider with incomplete tilemap');
      
      // Store for later when the map is ready
      if (this.collisionCheckSafety) {
        this.collisionCheckSafety.pendingColliders.push({
          object1, object2, callback, processCallback, context
        });
        console.log('Added pending collider for when tilemap is ready');
        return null;
      }
      return null;
    }
    
    return this.physics.add.collider(object1, object2, callback, processCallback, context);
  }

  // Apply all pending colliders when collision layer is ready
  applyPendingColliders() {
    if (!this.collisionCheckSafety || !this.collisionCheckSafety.pendingColliders) {
      return;
    }
    
    // Apply pending colliders
    this.collisionCheckSafety.pendingColliders.forEach(colliderData => {
      if (colliderData.object1 && colliderData.object2) {
        this.physics.add.collider(
          colliderData.object1, 
          colliderData.object2, 
          colliderData.callback, 
          colliderData.processCallback, 
          colliderData.context
        );
      }
    });
    
    // Clear pending colliders
    this.collisionCheckSafety.pendingColliders = [];
    this.collisionCheckSafety.isReady = true;
  }
}

export default GameScene;