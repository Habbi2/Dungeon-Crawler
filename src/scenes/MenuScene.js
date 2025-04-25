import Phaser from 'phaser';

class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MenuScene' });
  }

  create() {
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    // Create title text
    const title = this.add.text(width / 2, height / 4, 'DUNGEON CRAWLER', {
      fontFamily: 'monospace',
      fontSize: '48px',
      fontStyle: 'bold',
      color: '#ffffff',
      align: 'center',
      stroke: '#000000',
      strokeThickness: 6
    }).setOrigin(0.5);

    // Create start game button
    const startButton = this.add.text(width / 2, height / 2, 'START GAME', {
      fontFamily: 'monospace',
      fontSize: '32px',
      color: '#ffffff',
      align: 'center',
      stroke: '#000000',
      strokeThickness: 4,
      padding: { x: 20, y: 10 }
    })
    .setOrigin(0.5)
    .setInteractive({ useHandCursor: true })
    .on('pointerover', () => startButton.setColor('#ffff00'))
    .on('pointerout', () => startButton.setColor('#ffffff'))
    .on('pointerdown', () => {
      // Unlock audio context when player starts the game
      if (this.sound && this.sound.context && this.sound.context.state === 'suspended') {
        this.sound.context.resume();
      }
      this.scene.start('GameScene');
      this.scene.launch('UIScene');
    });

    // Create multiplayer button (for future implementation)
    const multiplayerButton = this.add.text(width / 2, height / 2 + 80, 'MULTIPLAYER', {
      fontFamily: 'monospace',
      fontSize: '32px',
      color: '#888888', // Gray color to indicate it's not yet implemented
      align: 'center',
      stroke: '#000000',
      strokeThickness: 4,
      padding: { x: 20, y: 10 }
    })
    .setOrigin(0.5)
    .setInteractive({ useHandCursor: true })
    .on('pointerover', () => multiplayerButton.setColor('#aaaaaa'))
    .on('pointerout', () => multiplayerButton.setColor('#ffffff'))
    .on('pointerdown', () => {
      // Unlock audio context when player starts the game
      if (this.sound && this.sound.context && this.sound.context.state === 'suspended') {
        this.sound.context.resume();
        console.log('AudioContext unlocked successfully');
      }
      
      // Start the multiplayer game
      this.scene.start('GameScene', { multiplayer: true });
      this.scene.launch('UIScene');
      
      // Show connecting message
      const gameScene = this.scene.get('GameScene');
      gameScene.events.once('create', () => {
        gameScene.events.emit('showMessage', 'Connecting to multiplayer server...');
      });
    });

    // Add credits text
    this.add.text(width / 2, height - 50, '© 2025 Dungeon Crawler Game', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffffff',
      align: 'center'
    }).setOrigin(0.5);

    // Add a bouncing animation to the title
    this.tweens.add({
      targets: title,
      y: title.y - 10,
      duration: 1500,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1
    });

    // Add global audio context unlock handler
    this.input.on('pointerdown', () => {
      if (this.sound && this.sound.context && this.sound.context.state === 'suspended') {
        this.sound.context.resume().then(() => {
          console.log('AudioContext unlocked successfully');
        }).catch(err => {
          console.error('Error resuming AudioContext:', err);
        });
      }
    });
  }
}

export default MenuScene;