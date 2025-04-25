import multiplayerService from './MultiplayerService';

/**
 * Manages remote players in the game scene
 */
class RemotePlayerManager {
  constructor(scene) {
    this.scene = scene;
    this.players = {};
    this.nameLabels = {};
    this.healthBars = {};
  }

  /**
   * Initialize the remote player manager
   */
  init() {
    // Set up event handlers for multiplayer events
    multiplayerService.on('playerJoined', this.handlePlayerJoined.bind(this));
    multiplayerService.on('playerLeft', this.handlePlayerLeft.bind(this));
    multiplayerService.on('playerMoved', this.handlePlayerMoved.bind(this));
    multiplayerService.on('playerAttacked', this.handlePlayerAttacked.bind(this));
    multiplayerService.on('playerHealthUpdate', this.handlePlayerHealthUpdate.bind(this));
    multiplayerService.on('playerDied', this.handlePlayerDied.bind(this));
    multiplayerService.on('playerRespawned', this.handlePlayerRespawn.bind(this));
    multiplayerService.on('roomPlayersUpdated', this.handleRoomPlayersUpdated.bind(this));
  }

  /**
   * Clean up event listeners
   */
  destroy() {
    multiplayerService.off('playerJoined', this.handlePlayerJoined);
    multiplayerService.off('playerLeft', this.handlePlayerLeft);
    multiplayerService.off('playerMoved', this.handlePlayerMoved);
    multiplayerService.off('playerAttacked', this.handlePlayerAttacked);
    multiplayerService.off('playerHealthUpdate', this.handlePlayerHealthUpdate);
    multiplayerService.off('playerDied', this.handlePlayerDied);
    multiplayerService.off('playerRespawned', this.handlePlayerRespawn);
    multiplayerService.off('roomPlayersUpdated', this.handleRoomPlayersUpdated);
    
    // Destroy all player sprites
    Object.keys(this.players).forEach(id => {
      if (this.players[id]) {
        this.players[id].destroy();
      }
      if (this.nameLabels[id]) {
        this.nameLabels[id].destroy();
      }
      if (this.healthBars[id]) {
        this.healthBars[id].destroy();
      }
    });
    
    this.players = {};
    this.nameLabels = {};
    this.healthBars = {};
  }

  /**
   * Create a new remote player
   * @param {Object} playerInfo - Player information
   */
  handlePlayerJoined(playerInfo) {
    // Skip if this is our own ID or the player already exists
    if (playerInfo.id === multiplayerService.getConnectionState().playerId || this.players[playerInfo.id]) {
      console.log(`Skipping duplicate player creation: ${playerInfo.id}`);
      return;
    }
    
    console.log(`Creating new remote player: ${playerInfo.id} (${playerInfo.name})`);
    
    // Create player sprite
    const player = this.scene.physics.add.sprite(
      playerInfo.x, 
      playerInfo.y, 
      'character'
    ).setScale(2);
    
    // Add collider with the world bounds
    player.setCollideWorldBounds(true);
    
    // Set up collision with walls if tilemap exists
    if (this.scene.wallsLayer) {
      this.scene.physics.add.collider(player, this.scene.wallsLayer);
    }
    
    // Create name label
    const nameLabel = this.scene.add.text(
      playerInfo.x, 
      playerInfo.y - 30,
      playerInfo.name,
      { 
        fontSize: '14px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3
      }
    ).setOrigin(0.5);
    
    // Create health bar background
    const healthBarBg = this.scene.add.rectangle(
      playerInfo.x,
      playerInfo.y - 20,
      50, 6,
      0x222222
    ).setOrigin(0.5);
    
    // Create health bar
    const healthBar = this.scene.add.rectangle(
      playerInfo.x,
      playerInfo.y - 20,
      50 * (playerInfo.health / 100), 6,
      0x00ff00
    ).setOrigin(0, 0.5);
    healthBar.x = playerInfo.x - 25;
    
    // Group health bar components
    const healthBarGroup = this.scene.add.group();
    healthBarGroup.add(healthBarBg);
    healthBarGroup.add(healthBar);
    
    // Save references
    this.players[playerInfo.id] = player;
    this.nameLabels[playerInfo.id] = nameLabel;
    this.healthBars[playerInfo.id] = {
      container: healthBarGroup,
      background: healthBarBg,
      bar: healthBar,
      currentHealth: playerInfo.health
    };
    
    // Play initial animation based on player state
    player.anims.play(playerInfo.animation || 'player_idle_down');
    
    console.log(`Remote player joined: ${playerInfo.id} (${playerInfo.name})`);
  }

  /**
   * Remove a player when they leave
   * @param {Object} playerInfo - Player information
   */
  handlePlayerLeft(playerInfo) {
    console.log(`Remote player left: ${playerInfo.id}`);
    
    // Destroy player sprite and UI elements
    if (this.players[playerInfo.id]) {
      this.players[playerInfo.id].destroy();
      delete this.players[playerInfo.id];
    }
    
    if (this.nameLabels[playerInfo.id]) {
      this.nameLabels[playerInfo.id].destroy();
      delete this.nameLabels[playerInfo.id];
    }
    
    if (this.healthBars[playerInfo.id]) {
      this.healthBars[playerInfo.id].container.destroy(true);
      delete this.healthBars[playerInfo.id];
    }
  }

  /**
   * Update a player's position and animation
   * @param {Object} playerInfo - Player information
   */
  handlePlayerMoved(playerInfo) {
    if (this.players[playerInfo.id]) {
      const player = this.players[playerInfo.id];
      
      // Smoothly move the player to the new position
      this.scene.tweens.add({
        targets: player,
        x: playerInfo.x,
        y: playerInfo.y,
        duration: 100,
        ease: 'Linear'
      });
      
      // Update animation
      if (playerInfo.animation && player.anims.currentAnim?.key !== playerInfo.animation) {
        player.anims.play(playerInfo.animation);
      }
      
      // Update name label and health bar position
      if (this.nameLabels[playerInfo.id]) {
        this.nameLabels[playerInfo.id].x = playerInfo.x;
        this.nameLabels[playerInfo.id].y = playerInfo.y - 30;
      }
      
      if (this.healthBars[playerInfo.id]) {
        this.healthBars[playerInfo.id].background.x = playerInfo.x;
        this.healthBars[playerInfo.id].background.y = playerInfo.y - 20;
        this.healthBars[playerInfo.id].bar.y = playerInfo.y - 20;
        this.healthBars[playerInfo.id].bar.x = playerInfo.x - 25;
      }
    }
  }

  /**
   * Handle player attack animation
   * @param {Object} attackInfo - Attack information
   */
  handlePlayerAttacked(attackInfo) {
    if (this.players[attackInfo.id]) {
      const player = this.players[attackInfo.id];
      
      // Play attack animation based on direction
      const attackAnim = `player_attack_${attackInfo.direction}`;
      player.anims.play(attackAnim);
      
      // Return to idle after attack completes
      this.scene.time.delayedCall(300, () => {
        if (player.active) {
          player.anims.play(`player_idle_${attackInfo.direction}`);
        }
      });
    }
  }

  /**
   * Update player health display
   * @param {Object} healthInfo - Health information
   */
  handlePlayerHealthUpdate(healthInfo) {
    if (this.healthBars[healthInfo.id]) {
      const healthBarData = this.healthBars[healthInfo.id];
      healthBarData.currentHealth = healthInfo.health;
      
      // Update health bar width based on health percentage
      const healthPercent = Math.max(0, healthInfo.health) / 100;
      const barWidth = 50 * healthPercent;
      
      // Animate health bar change
      this.scene.tweens.add({
        targets: healthBarData.bar,
        scaleX: healthPercent,
        duration: 200,
        ease: 'Power1'
      });
      
      // Change color based on health level
      if (healthInfo.health < 30) {
        healthBarData.bar.fillColor = 0xff0000; // Red
      } else if (healthInfo.health < 60) {
        healthBarData.bar.fillColor = 0xffff00; // Yellow
      } else {
        healthBarData.bar.fillColor = 0x00ff00; // Green
      }
    }
  }

  /**
   * Handle player death
   * @param {Object} playerInfo - Player information
   */
  handlePlayerDied(playerInfo) {
    if (this.players[playerInfo.id]) {
      const player = this.players[playerInfo.id];
      
      // Play death animation or just change appearance
      player.setTint(0x555555);
      player.setAlpha(0.7);
      
      // Update health bar to empty
      if (this.healthBars[playerInfo.id]) {
        this.healthBars[playerInfo.id].bar.scaleX = 0;
        this.healthBars[playerInfo.id].bar.fillColor = 0xff0000;
      }
    }
  }

  /**
   * Handle player respawn
   * @param {Object} playerInfo - Player information
   */
  handlePlayerRespawn(playerInfo) {
    if (this.players[playerInfo.id]) {
      const player = this.players[playerInfo.id];
      
      // Move player to respawn position
      player.x = playerInfo.x;
      player.y = playerInfo.y;
      
      // Reset appearance
      player.clearTint();
      player.setAlpha(1);
      
      // Reset health bar
      if (this.healthBars[playerInfo.id]) {
        const healthBarData = this.healthBars[playerInfo.id];
        healthBarData.currentHealth = playerInfo.health;
        healthBarData.bar.scaleX = 1;
        healthBarData.bar.fillColor = 0x00ff00;
        
        // Update position
        healthBarData.background.x = playerInfo.x;
        healthBarData.background.y = playerInfo.y - 20;
        healthBarData.bar.y = playerInfo.y - 20;
        healthBarData.bar.x = playerInfo.x - 25;
      }
      
      // Update name label position
      if (this.nameLabels[playerInfo.id]) {
        this.nameLabels[playerInfo.id].x = playerInfo.x;
        this.nameLabels[playerInfo.id].y = playerInfo.y - 30;
      }
      
      // Play idle animation
      player.anims.play('player_idle_down');
    }
  }

  /**
   * Update all players in the room
   * @param {Object} players - All players in the room
   */
  handleRoomPlayersUpdated(players) {
    // Remove any players that aren't in the new list
    Object.keys(this.players).forEach(id => {
      if (!players[id]) {
        this.handlePlayerLeft({ id });
      }
    });
    
    // Add or update players in the list
    Object.keys(players).forEach(id => {
      if (!this.players[id]) {
        this.handlePlayerJoined(players[id]);
      } else {
        // Update existing player
        this.handlePlayerMoved(players[id]);
        this.handlePlayerHealthUpdate({
          id,
          health: players[id].health
        });
      }
    });
  }
}

export default RemotePlayerManager;