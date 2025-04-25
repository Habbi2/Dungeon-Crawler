import Phaser from 'phaser';

class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload() {
    // Create loading bar
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;
    
    // Loading bar background
    const backgroundBar = this.add.graphics();
    backgroundBar.fillStyle(0x222222, 0.8);
    backgroundBar.fillRect(width / 4 - 2, height / 2 - 18, width / 2 + 4, 36);
    
    // Loading bar
    const progressBar = this.add.graphics();
    const progressText = this.add.text(width / 2, height / 2 + 50, 'Loading...', {
      font: '20px monospace',
      fill: '#ffffff'
    }).setOrigin(0.5);

    // Loading progress event
    this.load.on('progress', (value) => {
      progressBar.clear();
      progressBar.fillStyle(0xffffff, 1);
      progressBar.fillRect(width / 4, height / 2 - 16, (width / 2) * value, 32);
      progressText.setText(`Loading assets... ${Math.floor(value * 100)}%`);
    });
    
    this.load.on('complete', () => {
      progressBar.destroy();
      backgroundBar.destroy();
      progressText.destroy();
    });

    // Load character spritesheets
    this.load.spritesheet('character', 'assets/2D Pixel Dungeon Asset Pack/character and tileset/Dungeon_Character.png', { 
      frameWidth: 16, 
      frameHeight: 16 
    });
    
    // Load tileset
    this.load.image('tiles', 'assets/2D Pixel Dungeon Asset Pack/character and tileset/Dungeon_Tileset.png');
    
    // Load skeleton enemy spritesheets
    this.load.spritesheet('skeleton1_idle', 'assets/Enemy_Animations_Set/enemies-skeleton1_idle.png', { 
      frameWidth: 32, 
      frameHeight: 32 
    });
    
    this.load.spritesheet('skeleton1_attack', 'assets/Enemy_Animations_Set/enemies-skeleton1_attack.png', { 
      frameWidth: 32, 
      frameHeight: 32 
    });
    
    this.load.spritesheet('skeleton1_movement', 'assets/Enemy_Animations_Set/enemies-skeleton1_movement.png', { 
      frameWidth: 32, 
      frameHeight: 32 
    });
    
    this.load.spritesheet('skeleton1_death', 'assets/Enemy_Animations_Set/enemies-skeleton1_death.png', { 
      frameWidth: 32, 
      frameHeight: 32 
    });
    
    // Load vampire enemy spritesheets
    this.load.spritesheet('vampire_idle', 'assets/Enemy_Animations_Set/enemies-vampire_idle.png', { 
      frameWidth: 32, 
      frameHeight: 32 
    });
    
    this.load.spritesheet('vampire_attack', 'assets/Enemy_Animations_Set/enemies-vampire_attack.png', { 
      frameWidth: 32, 
      frameHeight: 32 
    });
    
    this.load.spritesheet('vampire_movement', 'assets/Enemy_Animations_Set/enemies-vampire_movement.png', { 
      frameWidth: 32, 
      frameHeight: 32 
    });
    
    this.load.spritesheet('vampire_death', 'assets/Enemy_Animations_Set/enemies-vampire_death.png', { 
      frameWidth: 32, 
      frameHeight: 32 
    });
    
    // Load UI elements
    this.load.image('arrow_up', 'assets/2D Pixel Dungeon Asset Pack/interface/arrow_1.png');
    this.load.image('arrow_right', 'assets/2D Pixel Dungeon Asset Pack/interface/arrow_2.png');
    this.load.image('arrow_down', 'assets/2D Pixel Dungeon Asset Pack/interface/arrow_3.png');
    this.load.image('arrow_left', 'assets/2D Pixel Dungeon Asset Pack/interface/arrow_4.png');
    
    // Load item sprites
    this.load.spritesheet('chest', 'assets/2D Pixel Dungeon Asset Pack/items and trap_animation/chest/chest_1.png', {
      frameWidth: 16,
      frameHeight: 16
    });
    
    this.load.spritesheet('health_potion', 'assets/2D Pixel Dungeon Asset Pack/items and trap_animation/flasks/flasks_1_1.png', {
      frameWidth: 16,
      frameHeight: 16
    });
    
    this.load.spritesheet('weapon', 'assets/2D Pixel Dungeon Asset Pack/items and trap_animation/peaks/peaks_1.png', {
      frameWidth: 16,
      frameHeight: 16
    });
    
    this.load.spritesheet('trap', 'assets/2D Pixel Dungeon Asset Pack/items and trap_animation/peaks/peaks_3.png', {
      frameWidth: 16,
      frameHeight: 16
    });
    
    this.load.spritesheet('coin', 'assets/2D Pixel Dungeon Asset Pack/items and trap_animation/coin/coin_1.png', {
      frameWidth: 16,
      frameHeight: 16
    });
    
    // Load audio (optional)
    // this.load.audio('background_music', 'assets/audio/dungeon_theme.mp3');
    // this.load.audio('player_attack', 'assets/audio/player_attack.wav');
    // this.load.audio('enemy_hurt', 'assets/audio/enemy_hurt.wav');
    // this.load.audio('item_pickup', 'assets/audio/item_pickup.wav');
  }

  create() {
    // Create animations for characters and enemies
    
    // Character animations - Using the red warrior character (first row)
    this.anims.create({
      key: 'player_idle_down',
      frames: this.anims.generateFrameNumbers('character', { frames: [1, 2] }), // Alternating between knight and pope
      frameRate: 2,
      repeat: -1
    });
    
    this.anims.create({
      key: 'player_walk_down',
      frames: this.anims.generateFrameNumbers('character', { start: 1, end: 2 }), // Using only 2 frames
      frameRate: 8,
      repeat: -1
    });
    
    this.anims.create({
      key: 'player_idle_up',
      frames: this.anims.generateFrameNumbers('character', { frames: [1, 2] }), // Alternating between knight and pope
      frameRate: 2,
      repeat: -1
    });
    
    this.anims.create({
      key: 'player_walk_up',
      frames: this.anims.generateFrameNumbers('character', { start: 1, end: 2 }), // Using only 2 frames
      frameRate: 8,
      repeat: -1
    });
    
    this.anims.create({
      key: 'player_idle_right',
      frames: this.anims.generateFrameNumbers('character', { start: 1, end: 2 }), // Alternating between knight and pope
      frameRate: 2,
      repeat: -1
    });
    
    this.anims.create({
      key: 'player_walk_right',
      frames: this.anims.generateFrameNumbers('character', { start: 1, end: 2 }), // Using only 2 frames
      frameRate: 8,
      repeat: -1
    });
    
    this.anims.create({
      key: 'player_idle_left',
      frames: this.anims.generateFrameNumbers('character', { start: 1, end: 2 }),
      frameRate: 10,
      repeat: -1
    });
    
    this.anims.create({
      key: 'player_walk_left',
      frames: this.anims.generateFrameNumbers('character', { start: 1, end: 2 }), // Using only 2 frames
      frameRate: 8,
      repeat: -1
    });
    
    // Player attack animations - using frames that actually exist in the spritesheet
    this.anims.create({
      key: 'player_attack_down',
      frames: this.anims.generateFrameNumbers('character', { frames: [1, 2, 1] }),
      frameRate: 12,
      repeat: 0
    });
    
    this.anims.create({
      key: 'player_attack_up',
      frames: this.anims.generateFrameNumbers('character', { frames: [1, 2, 1] }),
      frameRate: 12,
      repeat: 0
    });
    
    this.anims.create({
      key: 'player_attack_right',
      frames: this.anims.generateFrameNumbers('character', { frames: [1, 2, 1] }),
      frameRate: 12,
      repeat: 0
    });
    
    this.anims.create({
      key: 'player_attack_left',
      frames: this.anims.generateFrameNumbers('character', { frames: [1, 2, 1] }),
      frameRate: 12,
      repeat: 0
    });
    
    // Skeleton animations
    this.anims.create({
      key: 'skeleton_idle',
      frames: this.anims.generateFrameNumbers('skeleton1_idle', { start: 0, end: 3 }),
      frameRate: 6,
      repeat: -1
    });
    
    this.anims.create({
      key: 'skeleton_attack',
      frames: this.anims.generateFrameNumbers('skeleton1_attack', { start: 0, end: 7 }),
      frameRate: 10,
      repeat: 0
    });
    
    this.anims.create({
      key: 'skeleton_walk',
      frames: this.anims.generateFrameNumbers('skeleton1_movement', { start: 0, end: 3 }),
      frameRate: 8,
      repeat: -1
    });
    
    this.anims.create({
      key: 'skeleton_death',
      frames: this.anims.generateFrameNumbers('skeleton1_death', { start: 0, end: 3 }),
      frameRate: 8,
      repeat: 0
    });
    
    // Vampire animations
    this.anims.create({
      key: 'vampire_idle',
      frames: this.anims.generateFrameNumbers('vampire_idle', { start: 0, end: 3 }),
      frameRate: 6,
      repeat: -1
    });
    
    this.anims.create({
      key: 'vampire_attack',
      frames: this.anims.generateFrameNumbers('vampire_attack', { start: 0, end: 7 }),
      frameRate: 10,
      repeat: 0
    });
    
    this.anims.create({
      key: 'vampire_walk',
      frames: this.anims.generateFrameNumbers('vampire_movement', { start: 0, end: 3 }),
      frameRate: 8,
      repeat: -1
    });
    
    this.anims.create({
      key: 'vampire_death',
      frames: this.anims.generateFrameNumbers('vampire_death', { start: 0, end: 5 }),
      frameRate: 8,
      repeat: 0
    });
    
    // Item animations
    this.anims.create({
      key: 'chest_open',
      frames: this.anims.generateFrameNumbers('chest', { start: 0, end: 0 }),
      frameRate: 5,
      repeat: 0
    });
    
    this.anims.create({
      key: 'coin_spin',
      frames: this.anims.generateFrameNumbers('coin', { start: 0, end: 0 }),
      frameRate: 8,
      repeat: -1
    });
    
    this.anims.create({
      key: 'trap_activate',
      frames: this.anims.generateFrameNumbers('trap', { start: 0, end: 0 }),
      frameRate: 8,
      repeat: 0
    });
    
    this.anims.create({
      key: 'potion_idle',
      frames: this.anims.generateFrameNumbers('health_potion', { start: 0, end: 0 }),
      frameRate: 1,
      repeat: -1
    });

    // Start the menu scene after loading is complete
    this.scene.start('MenuScene');
  }
}

export default BootScene;