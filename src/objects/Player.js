import Phaser from 'phaser';

class Player extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, texture) {
    super(scene, x, y, texture, 1); // Starting with idle down frame
    
    this.scene = scene;
    this.health = 100;
    this.maxHealth = 100;
    this.attackPower = 10;
    this.speed = 100;
    this.gold = 0;
    this.isAttacking = false;
    this.isInvulnerable = false;
    this.direction = 'down'; // 'down', 'up', 'left', 'right'
    this.attackCooldown = 300; // Time between attacks in ms
    this.lastAttackTime = 0;
    
    // Camera control flags
    this.cameraLocked = false;
    this.dashingDirection = null;
    
    this.inventory = [
      // Starting inventory
      { type: 'health_potion', count: 2 }
    ];
    
    // Add to scene and enable physics
    scene.add.existing(this);
    scene.physics.add.existing(this);
    
    // Configure physics body
    this.body.setSize(12, 12); // Smaller hitbox than sprite
    this.body.setOffset(2, 4);
    
    // Set appropriate depth to ensure player appears above the map
    this.setDepth(10);
    
    // Set up input handling
    this.keys = scene.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      attack: Phaser.Input.Keyboard.KeyCodes.SPACE,
      inventory: Phaser.Input.Keyboard.KeyCodes.I,
      dash: Phaser.Input.Keyboard.KeyCodes.SHIFT // Add dash key
    });
    
    // Mobile control state
    this.mobileInputs = {
      up: false,
      down: false,
      left: false,
      right: false
    };
    
    // For analog-style controls with the joystick
    this.mobileVector = { x: 0, y: 0 };
    
    // Create attack hitbox
    this.createAttackHitbox();
    
    // Update UI initially
    this.updateUI();
    
    // Ensure collision volumes are initialized properly
    this.safeInitializeCollisionDetection();
  }
  
  createAttackHitbox() {
    // Create an invisible sprite for the attack hitbox
    this.attackHitbox = this.scene.physics.add.sprite(this.x, this.y, 'character');
    this.attackHitbox.setVisible(false);
    this.attackHitbox.setActive(false);
    this.attackHitbox.setSize(24, 24);
    
    // Add attack sprites for visual feedback
    this.attackEffects = {};
    
    // Check if player_attack texture is available, otherwise use character texture as fallback
    // Also check if character texture exists before using it
    const attackTexture = this.scene.textures.exists('player_attack') ? 
                         'player_attack' : 
                         (this.scene.textures.exists('character') ? 'character' : null);
    
    if (attackTexture) {
      ['up', 'down', 'left', 'right'].forEach(dir => {
        // Create attack effect sprite for each direction
        const sprite = this.scene.add.sprite(this.x, this.y, attackTexture);
        sprite.setVisible(false);
        this.attackEffects[dir] = sprite;
      });
    } else {
      console.warn('No suitable texture found for attack effects');
    }
  }
  
  // Safety method for initializing collision-related properties
  safeInitializeCollisionDetection() {
    if (!this.body) {
      console.warn('Player body not initialized properly');
      return;
    }
    
    // Set up collision volumes appropriately 
    this.body.setCollideWorldBounds(true);
    
    // Ensure we have a valid physics body for collision detection
    if (!this.body.checkCollision) {
      this.body.checkCollision = {
        none: false,
        up: true,
        down: true,
        left: true,
        right: true
      };
    }
  }

  update() {
    // Safety check - ensure body exists before using it
    if (!this.body) return;
    
    // Reset velocity
    this.body.setVelocity(0);
    
    // Attack handling
    if ((Phaser.Input.Keyboard.JustDown(this.keys.attack) || this.mobileInputs.attack) && 
        !this.isAttacking && this.canAttack()) {
      this.attack();
      return;
    }
    
    // Inventory handling
    if (Phaser.Input.Keyboard.JustDown(this.keys.inventory)) {
      this.scene.events.emit('showInventory');
      return;
    }
    
    // Dash handling
    if (Phaser.Input.Keyboard.JustDown(this.keys.dash) && !this.isAttacking && !this.dashingDirection) {
      this.dash();
      return;
    }
    
    // Movement from keyboard
    const keyboardMovement = this.handleKeyboardMovement();
    
    // Movement from mobile controls
    const mobileMovement = this.handleMobileMovement();
    
    // If we're not moving and not attacking, play idle animation
    if (!keyboardMovement && !mobileMovement && !this.isAttacking && !this.dashingDirection) {
      this.playIdleAnimation();
    }

    // If camera is in focus mode (e.g. during dash), update camera centering
    if (this.dashingDirection) {
      this.updateDashCamera();
    }
  }
  
  dash() {
    // Set dashing direction based on current facing
    this.dashingDirection = this.direction;
    
    // Slightly zoom out camera to show more of where we're going
    if (this.scene.zoomCamera) {
      this.scene.zoomCamera(-0.2);
    }
    
    // Set high speed boost in the dash direction
    const dashSpeed = 250; // Higher than regular speed
    
    switch (this.dashingDirection) {
      case 'up':
        this.body.setVelocityY(-dashSpeed);
        break;
      case 'down':
        this.body.setVelocityY(dashSpeed);
        break;
      case 'left':
        this.body.setVelocityX(-dashSpeed);
        break;
      case 'right':
        this.body.setVelocityX(dashSpeed);
        break;
    }
    
    // Play dash animation based on direction
    this.anims.play(`player_walk_${this.dashingDirection}`, true);
    
    // Create a trail effect
    this.createDashTrail();
    
    // End dash after a delay
    this.scene.time.delayedCall(300, () => {
      this.dashingDirection = null;
      
      // Reset camera zoom
      if (this.scene.cameraSettings) {
        this.scene.cameras.main.setZoom(this.scene.cameraSettings.zoomLevel);
      }
    });
  }
  
  createDashTrail() {
    // Create afterimages for dash effect
    const trailCount = 5;
    
    for (let i = 1; i <= trailCount; i++) {
      this.scene.time.delayedCall(i * 50, () => {
        if (!this.active) return; // Skip if player is no longer active
        
        // Create ghost/trail sprite at current position
        const trail = this.scene.add.sprite(this.x, this.y, this.texture.key, this.frame.name);
        
        // Match current frame and direction
        trail.setAlpha(0.7 - (i * 0.1));
        trail.setTint(0x3498db); // Blue tint
        
        // Fade out and destroy
        this.scene.tweens.add({
          targets: trail,
          alpha: 0,
          duration: 200,
          onComplete: () => {
            trail.destroy();
          }
        });
      });
    }
  }
  
  updateDashCamera() {
    // Add predictive camera effect during dash - look ahead in the direction we're dashing
    const lookAheadDistance = 50;
    let targetX = this.x;
    let targetY = this.y;
    
    switch (this.dashingDirection) {
      case 'up':
        targetY -= lookAheadDistance;
        break;
      case 'down':
        targetY += lookAheadDistance;
        break;
      case 'left':
        targetX -= lookAheadDistance;
        break;
      case 'right':
        targetX += lookAheadDistance;
        break;
    }
    
    // Apply a slight camera offset effect
    if (this.scene.cameras && this.scene.cameras.main) {
      this.scene.cameras.main.setFollowOffset(
        (targetX - this.x) * -0.5,
        (targetY - this.y) * -0.5
      );
    }
  }
  
  handleKeyboardMovement() {
    let moved = false;
    
    // Don't allow movement during attack animation
    if (this.isAttacking || this.dashingDirection) return moved;
    
    // Safety check for physics body
    if (!this.body) return moved;
    
    if (this.keys.up.isDown) {
      this.body.setVelocityY(-this.speed);
      this.direction = 'up';
      this.anims.play('player_walk_up', true);
      moved = true;
    } else if (this.keys.down.isDown) {
      this.body.setVelocityY(this.speed);
      this.direction = 'down';
      this.anims.play('player_walk_down', true);
      moved = true;
    }
    
    if (this.keys.left.isDown) {
      this.body.setVelocityX(-this.speed);
      this.direction = 'left';
      this.anims.play('player_walk_left', true);
      moved = true;
    } else if (this.keys.right.isDown) {
      this.body.setVelocityX(this.speed);
      this.direction = 'right';
      this.anims.play('player_walk_right', true);
      moved = true;
    }
    
    // Normalize movement to prevent faster diagonal movement
    if (moved && this.body.velocity) {
      this.body.velocity.normalize().scale(this.speed);
    }
    
    return moved;
  }
  
  handleMobileMovement() {
    let moved = false;
    
    // Don't allow movement during attack animation
    if (this.isAttacking || this.dashingDirection) return moved;
    
    // Safety check for physics body
    if (!this.body) return moved;
    
    if (this.mobileInputs.up) {
      this.body.setVelocityY(-this.speed);
      this.direction = 'up';
      this.anims.play('player_walk_up', true);
      moved = true;
    } else if (this.mobileInputs.down) {
      this.body.setVelocityY(this.speed);
      this.direction = 'down';
      this.anims.play('player_walk_down', true);
      moved = true;
    }
    
    if (this.mobileInputs.left) {
      this.body.setVelocityX(-this.speed);
      this.direction = 'left';
      this.anims.play('player_walk_left', true);
      moved = true;
    } else if (this.mobileInputs.right) {
      this.body.setVelocityX(this.speed);
      this.direction = 'right';
      this.anims.play('player_walk_right', true);
      moved = true;
    }
    
    // Normalize movement to prevent faster diagonal movement
    if (moved && this.body.velocity) {
      this.body.velocity.normalize().scale(this.speed);
    }
    
    return moved;
  }
  
  handleMobileControl(control, isActive) {
    // Update mobile input state
    if (control === 'up' || control === 'down' || control === 'left' || control === 'right') {
      this.mobileInputs[control] = isActive;
    } else if (control === 'attack') {
      this.mobileInputs.attack = isActive;
    }
  }
  
  playIdleAnimation() {
    switch (this.direction) {
      case 'up':
        this.anims.play('player_idle_up', true);
        break;
      case 'down':
        this.anims.play('player_idle_down', true);
        break;
      case 'left':
        this.anims.play('player_idle_left', true);
        break;
      case 'right':
        this.anims.play('player_idle_right', true);
        break;
    }
  }
  
  canAttack() {
    return this.scene.time.now > this.lastAttackTime + this.attackCooldown;
  }
  
  attack() {
    // Set attack state and timing
    this.isAttacking = true;
    this.lastAttackTime = this.scene.time.now;
    
    // Play attack animation based on direction
    const attackAnim = `player_attack_${this.direction}`;
    this.anims.play(attackAnim, true);
    
    // Position the attack hitbox based on direction
    let hitboxX = this.x;
    let hitboxY = this.y;
    const hitboxDistance = 20;
    
    switch (this.direction) {
      case 'up':
        hitboxY -= hitboxDistance;
        break;
      case 'down':
        hitboxY += hitboxDistance;
        break;
      case 'left':
        hitboxX -= hitboxDistance;
        break;
      case 'right':
        hitboxX += hitboxDistance;
        break;
    }
    
    // Add camera effect for attack
    if (this.scene.screenShake) {
      this.scene.screenShake(0.005, 100);
    }
    
    // Slightly zoom in for attack effect
    if (this.scene.zoomCamera) {
      this.scene.zoomCamera(0.1);
      
      // Reset zoom after attack
      this.scene.time.delayedCall(300, () => {
        if (this.scene.cameraSettings) {
          this.scene.cameras.main.setZoom(this.scene.cameraSettings.zoomLevel);
        }
      });
    }
    
    // Activate hitbox
    this.attackHitbox.setActive(true);
    this.attackHitbox.setPosition(hitboxX, hitboxY);
    
    // Show attack effect
    const effect = this.attackEffects[this.direction];
    effect.setPosition(hitboxX, hitboxY);
    effect.setVisible(true);
    effect.setAlpha(0.7);
    
    // Add tween for attack effect
    this.scene.tweens.add({
      targets: effect,
      alpha: 0,
      scale: 2.0,
      duration: 200,
      onComplete: () => {
        effect.setVisible(false);
        effect.setScale(1.5);
      }
    });
    
    // End attack state after a delay
    this.scene.time.delayedCall(300, () => {
      this.isAttacking = false;
      this.attackHitbox.setActive(false);
      // Return to idle animation after attack
      this.playIdleAnimation();
    });
    
    // Play attack sound if available
    // this.scene.sound.play('player_attack');
  }
  
  takeDamage(amount) {
    if (this.isInvulnerable) return;
    
    this.health -= amount;
    if (this.health < 0) this.health = 0;
    
    // Flash effect when taking damage
    this.setTint(0xff0000);
    this.scene.time.delayedCall(200, () => {
      this.clearTint();
    });
    
    // Add camera effects for damage
    if (this.scene.screenShake) {
      this.scene.screenShake(0.02, 200);
    }
    
    // Flash screen red for damage
    if (this.scene.flashCamera) {
      this.scene.flashCamera([255, 0, 0], 100);
    }
    
    // Check for death
    if (this.health <= 0) {
      this.die();
    }
    
    // Update UI
    this.updateUI();
    
    // Show damage message
    this.scene.events.emit('showMessage', `You took ${amount} damage!`);
  }
  
  die() {
    // Player death handling
    this.scene.events.emit('showMessage', 'You died!');
    
    // Add dramatic camera effects for death
    if (this.scene.zoomCamera) {
      this.scene.zoomCamera(-0.5); // Zoom out effect
    }
    
    if (this.scene.screenShake) {
      this.scene.screenShake(0.05, 1000); // Longer, stronger shake
    }
    
    // Disable player control
    this.active = false;
    this.body.setVelocity(0);
    
    // Flash effect
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      yoyo: true,
      repeat: 5,
      duration: 200,
      onComplete: () => {
        this.alpha = 1;
      }
    });
    
    // Game over after a delay
    this.scene.time.delayedCall(2000, () => {
      // Reset the player stats before restarting
      this.health = this.maxHealth;
      this.gold = Math.floor(this.gold / 2); // Lose half your gold
      this.inventory = [{ type: 'health_potion', count: 1 }]; // Reset inventory
      
      // Reset to menu
      this.scene.scene.start('MenuScene');
    });
  }
  
  healPlayer(amount) {
    this.health += amount;
    if (this.health > this.maxHealth) {
      this.health = this.maxHealth;
    }
    
    // Healing effect
    this.setTint(0x00ff00);
    this.scene.time.delayedCall(200, () => {
      this.clearTint();
    });
    
    // Add camera effects for healing
    if (this.scene.flashCamera) {
      this.scene.flashCamera([0, 255, 0], 100);
    }
    
    // Update UI
    this.updateUI();
    
    // Show healing message
    this.scene.events.emit('showMessage', `Healed ${amount} health!`);
  }
  
  addGold(amount) {
    this.gold += amount;
    
    // Update UI
    this.updateUI();
    
    // Show gold message
    this.scene.events.emit('showMessage', `Found ${amount} gold!`);
  }
  
  addToInventory(itemType) {
    // Check if we already have this stackable item
    const existingItem = this.inventory.find(item => item.type === itemType);
    
    if (existingItem) {
      existingItem.count++;
    } else {
      // Add new item
      this.inventory.push({
        type: itemType,
        count: 1
      });
    }
    
    // Update UI
    this.updateUI();
  }
  
  useItem(index) {
    if (index >= 0 && index < this.inventory.length) {
      const item = this.inventory[index];
      
      switch (item.type) {
        case 'health_potion':
          // Use health potion
          this.healPlayer(25);
          break;
        case 'weapon':
          // Equip weapon
          this.attackPower += 5;
          this.scene.events.emit('showMessage', 'Equipped a stronger weapon!');
          break;
        case 'armor':
          // Equip armor
          this.maxHealth += 20;
          this.health += 20;
          this.scene.events.emit('showMessage', 'Equipped better armor!');
          break;
        default:
          return;
      }
      
      // Remove the used item (or decrease count)
      item.count--;
      if (item.count <= 0) {
        this.inventory.splice(index, 1);
      }
      
      // Update UI
      this.updateUI();
    }
  }
  
  updateUI() {
    // Emit events to update the UI
    this.scene.events.emit('playerHealthChanged', this.health, this.maxHealth);
    this.scene.events.emit('playerGoldChanged', this.gold);
    this.scene.events.emit('playerInventoryChanged', this.inventory);
  }
  
  // Ensure both versions of the method name work (original and possibly misspelled version)
  setInvulnerable(value) {
    this.isInvulnerable = value;
    
    // Visual indicator for invulnerability
    if (value) {
      this.alpha = 0.7;
    } else {
      this.alpha = 1;
    }
  }
  
  // Add potential alternative spelling that might be used elsewhere
  setInvincible(value) {
    // Call the actual method
    this.setInvulnerable(value);
  }
  
  // Helper method to track map seed changes
  reportMapSeedChange(oldSeed, newSeed) {
    console.log(`Map seed changed: ${oldSeed} → ${newSeed}`);
    
    // If seeds are rapidly changing, store the last few for analysis
    if (!this.scene.recentSeeds) {
      this.scene.recentSeeds = [];
    }
    
    this.scene.recentSeeds.push({
      time: Date.now(),
      oldSeed,
      newSeed
    });
    
    // Keep only the last 5 seed changes
    if (this.scene.recentSeeds.length > 5) {
      this.scene.recentSeeds.shift();
    }
    
    // If we have multiple rapid seed changes, log a warning
    if (this.scene.recentSeeds.length >= 2) {
      const lastChange = this.scene.recentSeeds[this.scene.recentSeeds.length - 1];
      const previousChange = this.scene.recentSeeds[this.scene.recentSeeds.length - 2];
      
      const timeDiff = lastChange.time - previousChange.time;
      if (timeDiff < 1000) {
        console.warn(`Rapid map seed changes detected: ${timeDiff}ms between changes!`);
      }
    }
  }
}

export default Player;