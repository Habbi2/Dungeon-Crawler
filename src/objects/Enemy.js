import Phaser from 'phaser';

class Enemy extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, texture, enemyType = 'skeleton') {
    super(scene, x, y, texture, 0);
    
    this.scene = scene;
    this.enemyType = enemyType;
    this.health = enemyType === 'boss' ? 100 : (enemyType === 'vampire' ? 40 : 20);
    this.maxHealth = this.health;
    this.attackPower = enemyType === 'boss' ? 20 : (enemyType === 'vampire' ? 15 : 10);
    this.speed = enemyType === 'boss' ? 60 : (enemyType === 'vampire' ? 80 : 70);
    this.aggro = false;
    this.aggroRadius = enemyType === 'boss' ? 250 : 150;
    this.attackRadius = 20;
    this.attackCooldown = 1000;
    this.lastAttackTime = 0;
    this.isDead = false;
    this.playedDeathAnim = false;
    this.direction = 'down';
    this.state = 'idle';
    this.lastStateChange = 0;
    this.stateChangeCooldown = 1500;
    
    // Set proper rendering depth to ensure entity appears above the map
    this.setDepth(10);
    
    // Set animation prefix based on enemy type with safeguard for animation existence
    if (enemyType === 'boss' || enemyType === 'vampire') {
      this.animPrefix = 'vampire';
    } else {
      // Changed the order: Check for 'skeleton_idle' first since that's what's actually created in BootScene
      if (scene.anims.exists('skeleton_idle')) {
        this.animPrefix = 'skeleton';
      } else if (scene.anims.exists('skeleton1_idle')) {
        this.animPrefix = 'skeleton1';
      } else {
        this.animPrefix = 'vampire'; // Fallback to vampire animations which seem to be working
      }
    }
    
    // Call configureEnemy to set up type-specific properties
    this.configureEnemy();
    
    // Create unique ID for multiplayer tracking - use consistent ID generation
    // Use a deterministic ID format that will be the same across clients
    // Include position in the ID to ensure uniqueness based on spawn location
    this.enemyId = `enemy_${enemyType}_${Math.floor(x)}_${Math.floor(y)}`;
    // Also set the id property for consistent reference
    this.id = this.enemyId;
    
    // Create a simple patrol pattern for this enemy
    this.patrolPoints = [
      new Phaser.Math.Vector2(x, y),
      new Phaser.Math.Vector2(x + Phaser.Math.Between(-100, 100), y + Phaser.Math.Between(-100, 100))
    ];
    this.currentPatrolIndex = 0;
    
    // Add to scene and physics
    scene.add.existing(this);
    scene.physics.add.existing(this);
    
    // Configure physics - making body smaller than sprite for better collision
    this.body.setSize(12, 12);
    this.body.setOffset(2, 4);
    
    // Critical fix: Make the enemy immovable so it doesn't get pushed by player
    this.body.immovable = true;
    this.body.pushable = false;
    
    // Set animation based on type
    if (enemyType === 'boss') {
      this.anims.play('vampire_idle');
    } else if (enemyType === 'vampire') {
      this.anims.play('vampire_idle');
    } else {
      this.anims.play('skeleton1_idle');
    }
    
    // Add health bar
    this.createHealthBar();
    
    // Start playing the idle animation
    this.playIdleAnimation();
    
    // Set target to player
    this.target = scene.player;

    // Initialize the aggro flag to false

    this.aggro = false;

    // Set up safe collision handling
    this.safeInitializeCollisionDetection();
  }
  
  configureEnemy() {
    // Set properties based on enemy type
    switch(this.enemyType) {
      case 'skeleton':
        this.health = 30;
        this.maxHealth = 30;
        this.attackPower = 5;
        this.speed = 40;
        this.animPrefix = 'skeleton';
        break;
      case 'vampire':
        this.health = 50;
        this.maxHealth = 50;
        this.attackPower = 8;
        this.speed = 60;
        this.animPrefix = 'vampire';
        break;
      case 'boss':
        this.health = 100;
        this.maxHealth = 100;
        this.attackPower = 12;
        this.speed = 30;
        this.setScale(1.5); // Larger size
        this.animPrefix = 'vampire'; // Using vampire animations for boss
        break;
    }
  }
  
  createHealthBar() {
    // Create a container for the health bar
    this.healthBarContainer = this.scene.add.container(this.x, this.y - 20);
    
    // Health bar background
    this.healthBarBg = this.scene.add.rectangle(0, 0, 30, 4, 0x000000);
    this.healthBarBg.setOrigin(0.5, 0.5);
    
    // Actual health bar
    this.healthBarFill = this.scene.add.rectangle(0, 0, 30, 4, this.getHealthBarColor());
    this.healthBarFill.setOrigin(0.5, 0.5);
    
    // Add to container
    this.healthBarContainer.add([this.healthBarBg, this.healthBarFill]);
    
    // Hide by default - only show when hurt
    this.healthBarContainer.setVisible(false);
  }

  getHealthBarColor() {
    // Different colored health bars for different enemy types
    switch(this.enemyType) {
      case 'skeleton': return 0xff0000; // Red
      case 'vampire': return 0x9900cc;  // Purple
      case 'boss': return 0xff9900;     // Orange
      default: return 0xff0000;         // Default red
    }
  }
  
  playIdleAnimation() {
    // Check which animations are actually available in the scene
    const availableAnims = this.scene.anims.anims.entries;
    const animKeys = Object.keys(availableAnims);
    
    // Look for idle animations in order of preference
    const idleAnimOptions = [
      `${this.animPrefix}_idle`,      // First choice: specific prefix + idle
      'skeleton_idle',               // Second choice: skeleton_idle (changed order)
      'skeleton1_idle',              // Third choice: skeleton1_idle
      'vampire_idle'                 // Fallback: vampire_idle
    ];
    
    // Find the first available animation from our options
    const animToPlay = idleAnimOptions.find(anim => animKeys.includes(anim));
    
    if (animToPlay) {
      this.anims.play(animToPlay, true);
    } else {
      // Last resort: just stop any animation if we can't find a suitable one
      this.anims.stop();
      console.warn(`No idle animation found for enemy type ${this.enemyType}`);
    }
  }

  playWalkAnimation() {
    // Check which animations are actually available in the scene
    const availableAnims = this.scene.anims.anims.entries;
    const animKeys = Object.keys(availableAnims);
    
    // Look for walk/movement animations in order of preference
    const walkAnimOptions = [
      `${this.animPrefix}_walk`,     // First choice: specific prefix + walk
      `${this.animPrefix}_movement`, // Second choice: specific prefix + movement
      'skeleton1_movement',         // Third choice: skeleton1_movement
      'skeleton_movement',          // Fourth choice: skeleton_movement
      'vampire_movement',           // Fifth choice: vampire_movement
      `${this.animPrefix}_idle`,    // Sixth choice: fall back to idle animation
      'vampire_idle'                // Last resort: vampire_idle
    ];
    
    // Find the first available animation from our options
    const animToPlay = walkAnimOptions.find(anim => animKeys.includes(anim));
    
    if (animToPlay) {
      this.anims.play(animToPlay, true);
    } else {
      // Just stop if we can't find anything suitable
      this.anims.stop();
      console.warn(`No walk animation found for enemy type ${this.enemyType}`);
    }
  }

  playAttackAnimation() {
    // Check which animations are actually available in the scene
    const availableAnims = this.scene.anims.anims.entries;
    const animKeys = Object.keys(availableAnims);
    
    // Look for attack animations in order of preference
    const attackAnimOptions = [
      `${this.animPrefix}_attack`,   // First choice: specific prefix + attack
      'skeleton1_attack',           // Second choice: skeleton1_attack
      'skeleton_attack',            // Third choice: skeleton_attack
      'vampire_attack',             // Fourth choice: vampire_attack
      `${this.animPrefix}_idle`,    // Fifth choice: fall back to idle animation
      'vampire_idle'                // Last resort: vampire_idle
    ];
    
    // Find the first available animation from our options
    const animToPlay = attackAnimOptions.find(anim => animKeys.includes(anim));
    
    if (animToPlay) {
      this.anims.play(animToPlay, true);
    } else {
      // Just stop if we can't find anything suitable
      this.anims.stop();
      console.warn(`No attack animation found for enemy type ${this.enemyType}`);
    }
  }

  playDeathAnimation() {
    // Mark that we've played the death animation to avoid repeated attempts
    this.playedDeathAnim = true;
    
    // Check which animations are actually available in the scene
    const availableAnims = this.scene.anims.anims.entries;
    const animKeys = Object.keys(availableAnims);
    
    // Look for death animations in order of preference
    const deathAnimOptions = [
      `${this.animPrefix}_death`,    // First choice: specific prefix + death
      'skeleton1_death',            // Second choice: skeleton1_death
      'skeleton_death',             // Third choice: skeleton_death
      'vampire_death',              // Fourth choice: vampire_death
      `${this.animPrefix}_attack`,  // Fifth choice: use attack as substitute
      'vampire_attack',             // Sixth choice: vampire attack as substitute
      `${this.animPrefix}_idle`,    // Seventh choice: fall back to idle animation
      'vampire_idle'                // Last resort: vampire_idle
    ];
    
    // Find the first available animation from our options
    const animToPlay = deathAnimOptions.find(anim => animKeys.includes(anim));
    
    if (animToPlay) {
      this.anims.play(animToPlay, true);
    } else {
      // Just stop if we can't find anything suitable
      this.anims.stop();
      console.warn(`No death animation found for enemy type ${this.enemyType}`);
    }
  }
  
  update() {
    // Skip update if enemy is dead
    if (this.isDead) return;
    
    // Update health bar position regardless of control mode
    this.updateHealthBarPosition();
    
    // For non-host clients, handle server-controlled enemies differently
    if (this.serverControlled) {
      // Play animations based on current movement
      if (this.isMoving || (this.body && (Math.abs(this.body.velocity.x) > 0.5 || Math.abs(this.body.velocity.y) > 0.5))) {
        this.playWalkAnimation();
        
        // Update flip based on direction or velocity
        if (this.direction === 'left' || (this.body && this.body.velocity.x < -0.5)) {
          this.flipX = true;
        } else if (this.direction === 'right' || (this.body && this.body.velocity.x > 0.5)) {
          this.flipX = false;
        }
      } else {
        // Play idle animation if not moving
        this.playIdleAnimation();
      }
      
      // Keep applying the velocity to ensure consistent movement
      if (this.body && this.isMoving) {
        // Do not modify velocity here - use what was set from server data
      }
      
      return; // Skip the rest of the AI logic
    }
    
    // Host client: Normal AI behavior below this point
    
    // Safety check for target (player)
    if (!this.target || !this.target.active) {
      return;
    }
    
    // Track movement state for multiplayer sync
    const previousX = this.x;
    const previousY = this.y;
    
    // Get distance to target
    const distanceToTarget = Phaser.Math.Distance.Between(
      this.x, this.y, this.target.x, this.target.y
    );
    
    // Special boss behavior when near player
    if (this.enemyType === 'boss') {
      this.handleBossBehavior(distanceToTarget);
    }
    
    // Check if player is within aggro range
    if (distanceToTarget <= this.aggroRadius) {
      // Set aggro flag
      this.aggro = true;
      
      // Move towards the player
      this.moveTowardsTarget();
      
      // Check if we can attack
      if (distanceToTarget <= this.attackRadius && this.canAttack()) {
        this.attack();
      }
    } else if (this.aggro) {
      // If player is out of range but we're already aggroed, continue following
      this.moveTowardsTarget();
    } else {
      // Idle behavior when player is out of range and not aggroed
      if (this.body) {
        this.body.setVelocity(0);
      }
      this.playIdleAnimation();
    }
    
    // Update movement state for sync
    this.isMoving = previousX !== this.x || previousY !== this.y || 
                    (this.body && (Math.abs(this.body.velocity.x) > 0.5 || Math.abs(this.body.velocity.y) > 0.5));
    
    // Update direction based on movement
    if (this.body) {
      if (Math.abs(this.body.velocity.x) > Math.abs(this.body.velocity.y)) {
        this.direction = this.body.velocity.x > 0 ? 'right' : 'left';
      } else if (Math.abs(this.body.velocity.y) > 0.5) {
        this.direction = this.body.velocity.y > 0 ? 'down' : 'up';
      }
    }
  }
  
  handleBossBehavior(distanceToTarget) {
    // Boss warning when getting close
    if (distanceToTarget <= this.bossNearPlayerThreshold && !this.bossNearNotified) {
      // Show warning message
      this.scene.events.emit('showMessage', 'The boss has spotted you!');
      
      // Visual warning effect
      this.setTint(0xff6600);
      this.scene.tweens.add({
        targets: this,
        alpha: 0.7,
        yoyo: true,
        repeat: 3,
        duration: 150,
        onComplete: () => {
          this.clearTint();
          this.setAlpha(1);
        }
      });
      
      // Add camera shake effect
      this.scene.cameras.main.shake(300, 0.005);
      
      // Set flag to prevent repeated warnings
      this.bossNearNotified = true;
    }
    
    // Boss special attack when in range and off cooldown
    if (distanceToTarget <= this.bossSpecialAttackRange && 
        this.scene.time.now > this.bossLastSpecialAttack + this.bossSpecialAttackCooldown) {
      this.performBossSpecialAttack();
    }
  }
  
  performBossSpecialAttack() {
    // Safety check for target
    if (!this.target || !this.target.active) {
      return;
    }
    
    // Set cooldown timer
    this.bossLastSpecialAttack = this.scene.time.now;
    
    // Stop movement briefly
    const currentVelocity = {x: this.body.velocity.x, y: this.body.velocity.y};
    this.body.setVelocity(0, 0);
    
    // Show warning message
    this.scene.events.emit('showMessage', 'Boss is preparing a special attack!');
    
    // Visual charge-up effect
    const chargeEffect = this.scene.add.circle(this.x, this.y, 40, 0xff0000, 0.3);
    chargeEffect.setDepth(1);
    
    // Charge animation
    this.scene.tweens.add({
      targets: chargeEffect,
      scale: 1.5,
      alpha: 0.6,
      duration: 800,
      onComplete: () => {
        chargeEffect.destroy();
        
        // Additional safety check - target may be gone by now
        if (!this.target || !this.target.active) {
          return;
        }
        
        // Perform the actual attack
        const attackEffect = this.scene.add.circle(this.x, this.y, 60, 0xff0000, 0.5);
        attackEffect.setDepth(1);
        
        // Damage player if in range
        const distanceToPlayer = Phaser.Math.Distance.Between(
          this.x, this.y, this.target.x, this.target.y
        );
        
        if (distanceToPlayer <= 70) {
          if (typeof this.target.takeDamage === 'function') {
            this.target.takeDamage(this.attackPower * 2);
          }
          
          // Knock back player
          if (this.target.body && typeof this.target.body.setVelocity === 'function') {
            const knockbackDirection = new Phaser.Math.Vector2(
              this.target.x - this.x, 
              this.target.y - this.y
            ).normalize();
            
            this.target.body.setVelocity(
              knockbackDirection.x * 300,
              knockbackDirection.y * 300
            );
            
            // Reset player velocity after knockback
            this.scene.time.delayedCall(300, () => {
              if (this.target && this.target.active && this.target.body) {
                this.target.body.setVelocity(0, 0);
              }
            });
          }
        }
        
        // Explosion animation
        this.scene.tweens.add({
          targets: attackEffect,
          scale: 2,
          alpha: 0,
          duration: 500,
          onComplete: () => {
            attackEffect.destroy();
            
            // Resume movement after attack animation if still alive and has body
            if (this.active && !this.isDead && this.body) {
              this.body.setVelocity(currentVelocity.x, currentVelocity.y);
            }
          }
        });
        
        // Camera shake for impact
        this.scene.cameras.main.shake(300, 0.01);
      }
    });
  }
  
  moveTowardsTarget() {
    if (this.isDead) return;
    
    // Safety check for target
    if (!this.target || !this.target.active) {
      this.body.setVelocity(0);
      return;
    }
    
    // Calculate direction to player
    const directionX = this.target.x - this.x;
    const directionY = this.target.y - this.y;
    
    // Normalize and scale by speed
    const length = Math.sqrt(directionX * directionX + directionY * directionY);
    
    // Prevent division by zero
    if (length === 0) {
      this.body.setVelocity(0);
      return;
    }
    
    const normalizedX = directionX / length;
    const normalizedY = directionY / length;
    
    // Set enemy velocity towards the player with the appropriate speed
    this.body.setVelocity(
      normalizedX * this.speed,
      normalizedY * this.speed
    );
    
    // Ensure enemy doesn't get pushed away on collision
    this.body.pushable = false;
    
    // Fix for collision pushing enemy away - reset immovable property each frame
    this.body.immovable = true;
    
    // Store current direction for animation and multiplayer sync
    if (Math.abs(normalizedX) > Math.abs(normalizedY)) {
      this.direction = normalizedX > 0 ? 'right' : 'left';
    } else {
      this.direction = normalizedY > 0 ? 'down' : 'up';
    }
    
    // Set appropriate animation
    this.playWalkAnimation();
    
    // Flip sprite based on movement direction
    if (directionX < 0) {
      this.flipX = true;
    } else if (directionX > 0) {
      this.flipX = false;
    }
    
    // Update movement state
    this.isMoving = true;
  }
  
  canAttack() {
    return this.scene.time.now > this.lastAttackTime + this.attackCooldown;
  }
  
  attack() {
    // Set attack timing
    this.lastAttackTime = this.scene.time.now;
    
    // Play attack animation
    this.playAttackAnimation();
    
    // Visual indicator for attack
    const attackColor = this.enemyType === 'boss' ? 0xff9900 : 0xff0000;
    const attackSize = this.enemyType === 'boss' ? 30 : 20;
    
    const attackEffect = this.scene.add.circle(this.x, this.y, attackSize, attackColor, 0.3);
    this.scene.time.delayedCall(300, () => {
      attackEffect.destroy();
    });
    
    // The actual damage is handled in the collision callback in GameScene
  }
  
  takeDamage(amount) {
    this.health -= amount;
    
    // Show the health bar when damaged
    this.healthBarContainer.setVisible(true);
    this.updateHealthBar();
    
    // Hide health bar after a delay
    this.scene.time.delayedCall(3000, () => {
      this.healthBarContainer.setVisible(false);
    });
    
    // Flash effect when taking damage
    this.setTint(0xff0000);
    this.scene.time.delayedCall(200, () => {
      this.clearTint();
    });
    
    // Sound effect if available
    // if (this.scene.sound.get('enemy_hurt')) {
    //   this.scene.sound.play('enemy_hurt');
    // }
    
    // Check for death
    if (this.health <= 0) {
      this.die();
    }
  }
  
  updateHealthBar() {
    // Update health bar fill based on current health percentage
    const healthPercent = Math.max(0, this.health / this.maxHealth);
    this.healthBarFill.width = 30 * healthPercent;
  }
  
  updateHealthBarPosition() {
    if (this.healthBarContainer) {
      this.healthBarContainer.x = this.x;
      this.healthBarContainer.y = this.y - 20;
    }
  }
  
  die() {
    this.isDead = true;
    this.body.setVelocity(0);
    
    // Remove from enemies array in the game scene to prevent exit blocking
    if (this.scene && this.scene.enemies) {
      const enemyIndex = this.scene.enemies.indexOf(this);
      if (enemyIndex > -1) {
        this.scene.enemies.splice(enemyIndex, 1);
      }
    }
    
    // Play death animation
    this.playDeathAnimation();
    
    // Hide health bar
    this.healthBarContainer.setVisible(false);
    
    // Drop loot
    this.dropLoot();
    
    // Fade out and destroy
    this.scene.tweens.add({
      targets: this,
      alpha: 0,
      duration: 1000,
      ease: 'Power2',
      onComplete: () => {
        // Remove from scene
        this.destroy();
        this.healthBarContainer.destroy();
      }
    });
  }
  
  dropLoot() {
    // Safety check - ensure target exists and is active
    if (!this.target || !this.target.active) {
      console.warn('Cannot drop loot: target is not available');
      return;
    }
    
    // Determine what loot to drop
    let lootChance = Math.random();
    
    // Boss has better drops
    if (this.enemyType === 'boss') {
      try {
        // Boss always drops something good
        const goldAmount = Phaser.Math.Between(10, 25);
        
        // Check if methods exist before calling them
        if (typeof this.target.addGold === 'function') {
          this.target.addGold(goldAmount);
        }
        
        // And often drops a special item too
        if (Math.random() < 0.75) {
          if (typeof this.target.addToInventory === 'function') {
            this.target.addToInventory('weapon');
            this.scene.events.emit('showMessage', 'Boss dropped a powerful weapon!');
          }
        } else {
          if (typeof this.target.addToInventory === 'function') {
            this.target.addToInventory('health_potion');
            this.target.addToInventory('health_potion');
            this.scene.events.emit('showMessage', 'Boss dropped 2 health potions!');
          }
        }
      } catch (error) {
        console.error('Error dropping boss loot:', error);
      }
      return;
    }
    
    // Regular enemies
    try {
      if (lootChance < 0.7) {
        // 70% chance to drop gold
        const goldAmount = Phaser.Math.Between(1, 5);
        if (typeof this.target.addGold === 'function') {
          this.target.addGold(goldAmount);
        }
      } else if (lootChance < 0.9) {
        // 20% chance to drop health potion
        if (typeof this.target.addToInventory === 'function') {
          this.target.addToInventory('health_potion');
          this.scene.events.emit('showMessage', 'Enemy dropped a health potion!');
        }
      } else {
        // 10% chance to drop a weapon
        if (typeof this.target.attackPower !== 'undefined') {
          this.target.attackPower += 2;
          this.scene.events.emit('showMessage', 'Enemy dropped a weapon upgrade!');
        }
      }
    } catch (error) {
      console.error('Error dropping enemy loot:', error);
    }
  }

  // Safety method for initializing collision-related properties
  safeInitializeCollisionDetection() {
    if (!this.body) {
      console.warn('Enemy body not initialized properly');
      return;
    }
    
    // Set up collision volumes appropriately
    this.body.setCollideWorldBounds(true);
    
    // Critical fix: Make the enemy immovable so it doesn't get pushed by player
    this.body.immovable = true;
    this.body.pushable = false;
    
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
    
    // Prevent any collision attempts before the tilemap is ready
    // This will prevent "Cannot read properties of undefined (reading 'tileWidth')" errors
    this.body.onCollide = true;
    this.body.onOverlap = true;
    
    // Ensure the velocity is properly initialized
    this.body.setVelocity(0, 0);
  }
  
  // Update enemy with data received from server (for non-host clients)
  updateFromServer(data) {
    // Update position if there's a significant change
    const positionThreshold = 3.0;  // Smaller threshold for more responsive movement
    
    // Direct position update for large position differences
    if (Math.abs(this.x - data.x) > positionThreshold * 5 || Math.abs(this.y - data.y) > positionThreshold * 5) {
      this.x = data.x;
      this.y = data.y;
    } 
    // Smooth movement for smaller differences
    else if (Math.abs(this.x - data.x) > positionThreshold || Math.abs(this.y - data.y) > positionThreshold) {
      // Use tweens for smoother movement
      this.scene.tweens.add({
        targets: this,
        x: data.x,
        y: data.y,
        duration: 100, // Quick but smooth
        ease: 'Linear'
      });
    }
    
    // Update movement state
    this.isMoving = data.isMoving || false;
    
    // Apply velocity directly from server data
    if (this.body) {
      this.body.setVelocity(data.velocityX || 0, data.velocityY || 0);
      
      // Adjust motion to be more responsive to server changes
      if (Math.abs(data.velocityX) > 0.5 || Math.abs(data.velocityY) > 0.5) {
        this.isMoving = true;
      }
    }
    
    // Update direction from server
    if (data.direction) {
      this.direction = data.direction;
      
      // Update sprite flipping based on direction
      if (this.direction === 'left') {
        this.flipX = true;
      } else if (this.direction === 'right') {
        this.flipX = false;
      }
    }
    
    // Update health and other states
    if (data.health !== undefined) {
      // Only show damage effects if health decreased
      if (data.health < this.health) {
        this.setTint(0xff0000);
        this.scene.time.delayedCall(200, () => {
          if (this.active) this.clearTint();
        });
      }
      
      this.health = data.health;
      this.updateHealthBar();
      
      // Make health bar visible when damaged
      if (this.healthBarContainer) {
        this.healthBarContainer.setVisible(true);
        
        // Hide health bar after a delay
        this.scene.time.delayedCall(3000, () => {
          if (this.healthBarContainer && this.healthBarContainer.active) {
            this.healthBarContainer.setVisible(false);
          }
        });
      }
    }
    
    // Update aggro state if provided
    if (data.aggro !== undefined) {
      this.aggro = data.aggro;
    }
    
    // Update state if provided
    if (data.state) {
      this.state = data.state;
    }
    
    // Apply correct animation based on movement state and direction
    this.applyAnimationFromServerData(data);
    
    // Update other properties
    this.isDead = data.isDead || false;
    
    // Handle death animation if needed
    if (this.isDead && !this.playedDeathAnim) {
      this.die();
    }
    
    // Mark this enemy as server controlled
    this.serverControlled = true;
  }
  
  // New helper method to apply correct animation based on server data
  applyAnimationFromServerData(data) {
    if (this.isDead) {
      if (!this.playedDeathAnim) {
        this.playDeathAnimation();
      }
      return;
    }
    
    if (this.isMoving) {
      this.playWalkAnimation();
    } else {
      this.playIdleAnimation();
    }
  }
}

export default Enemy;