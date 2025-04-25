import Phaser from 'phaser';
import BootScene from './scenes/BootScene';
import MenuScene from './scenes/MenuScene';
import GameScene from './scenes/GameScene';
import UIScene from './scenes/UIScene';

// Helper function to detect mobile
const isMobile = () => {
  const userAgent = navigator.userAgent || navigator.vendor || window.opera;
  return /android|iPad|iPhone|iPod|webOS|BlackBerry|Windows Phone/i.test(userAgent) || 
         window.innerWidth <= 812 || window.innerHeight <= 812;
};

// Game configuration
const GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: 800,
  height: 600,
  pixelArt: true,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    // Mobile specific optimizations
    fullscreenTarget: 'game-container',
    expandParent: true,
    // Limit max pixel ratio for better performance on high-DPI mobile screens
    max: {
      width: 1920,
      height: 1080
    }
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 },
      debug: false,
      // Reduce physics framerate on mobile for better performance
      fps: isMobile() ? 30 : 60
    }
  },
  render: {
    antialiasGL: false,
    pixelArt: true,
    roundPixels: true,
    // Improve performance on mobile
    batchSize: isMobile() ? 1024 : 2048
  },
  // Reduce jitter on mobile devices
  disableContextMenu: true,
  // Lower fps on mobile for better battery life
  fps: {
    target: isMobile() ? 30 : 60,
    forceSetTimeOut: true
  },
  scene: [
    BootScene,
    MenuScene,
    GameScene,
    UIScene
  ]
};

export default GameConfig;