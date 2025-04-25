import Phaser from 'phaser';

class Enemy extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, texture, enemyType) {
    super(scene, x, y, texture);
    
    this.scene = scene;
    this.enemyType = enemyType;
    this.health = 30;
    this.maxHealth = 30;
    this.attackPower = 5;
    this.speed = 40;
    this.aggroRange = 150;
    this.isDead = false;
    this.lastAttackTime = 0;
    this.attackCooldown = 1500; // 1.5 seconds between attacks
    
    // Boss-specific properties
    this.bossNearPlayerThreshold = 200; // Distance to trigger boss warning
    this.bossNearNotified = false; // Track if we've already shown the warning
    this.bossSpecialAttackRange = 100; // Range for special attack
    this.bossLastSpecialAttack = 0; // Timing for special attacks
    this.bossSpecialAttackCooldown = 5000; // 5 seconds between special attacks
    
    // Configure based on enemy type
    this.configureEnemy();
    
    // Add to scene and enable physics
    scene.add.existing(this);
    scene.physics.add.existing(this);
    
    // Configure physics body
    this.body.setSize(16, 16);
    this.body.setOffset(8, 16);
    
    // Add health bar
    this.createHealthBar();
    
    // Start playing the idle animation
    this.playIdleAnimation();
    
    // Set target to player
    this.target = scene.player;
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
    // Play the appropriate idle animation based on enemy type
    this.anims.play(`${this.animPrefix}_idle`, true);
  }
  
  playWalkAnimation() {
    // Play the appropriate walk animation based on enemy type
    this.anims.play(`${this.animPrefix}_walk`, true);
  }
  
  playAttackAnimation() {
    // Play the appropriate attack animation based on enemy type
    this.anims.play(`${this.animPrefix}_attack`, true);
  }

  playDeathAnimation() {
    // Play the appropriate death animation based on enemy type
    if (this.anims.exists(`${this.animPrefix}_death`)) {
      this.anims.play(`${this.animPrefix}_death`, true);
    } else {
      // Fallback if death animation doesn't exist
      this.anims.play(`${this.animPrefix}_attack`, true);
    }
  }
  
  update() {
    // Skip update if enemy is dead
    if (this.isDead) return;
    
    // Safety check for target (player)
    if (!this.target || !this.target.active) {
      return;
    }
    
    // Update health bar position
    this.updateHealthBarPosition();
    
    // Get distance to target
    const distanceToTarget = Phaser.Math.Distance.Between(
      this.x, this.y, this.target.x, this.target.y
    );
    
    // Special boss behavior when near player
    if (this.enemyType === 'boss') {
      this.handleBossBehavior(distanceToTarget);
    }
    
    // Check if player is within aggro range
    if (distanceToTarget <= this.aggroRange) {
      // Move towards the player
      this.moveTowardsTarget();
      
      // Check if we can attack
      if (distanceToTarget <= 25 && this.canAttack()) {
        this.attack();
      }
    } else {
      // Idle behavior when player is out of range
      this.body.setVelocity(0);
      this.playIdleAnimation();
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
    const normalizedX = directionX / length;
    const normalizedY = directionY / length;
    
    this.body.setVelocity(
      normalizedX * this.speed,
      normalizedY * this.speed
    );
    
    // Set appropriate animation
    this.playWalkAnimation();
    
    // Flip sprite based on movement direction
    if (directionX < 0) {
      this.flipX = true;
    } else if (directionX > 0) {
      this.flipX = false;
    }
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
}

export default Enemy;