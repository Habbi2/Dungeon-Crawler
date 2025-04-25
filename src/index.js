import Phaser from 'phaser';
import GameConfig from './game';

// Helper function to check if we're on a mobile device
const isMobileDevice = () => {
  const userAgent = navigator.userAgent || navigator.vendor || window.opera;
  const mobileRegex = /android|iPad|iPhone|iPod|webOS|BlackBerry|Windows Phone/i;
  return mobileRegex.test(userAgent) || window.innerWidth <= 812 || window.innerHeight <= 812;
};

// Apply mobile-specific settings
if (isMobileDevice()) {
  console.log("Mobile device detected, applying optimized settings");
  
  // Make sure orientation handling is set up correctly
  window.addEventListener('orientationchange', function() {
    // Short timeout to allow the browser to complete the orientation change
    setTimeout(() => {
      if (window.game && window.game.isBooted) {
        window.game.scale.resize(window.innerWidth, window.innerHeight);
      }
    }, 200);
  });
  
  // Prevent pinch-zoom on mobile devices
  document.addEventListener('touchmove', function(event) {
    if (event.scale !== 1 && event.scale !== undefined) {
      event.preventDefault();
    }
  }, { passive: false });
}

// Start the game with the defined configuration
window.game = new Phaser.Game(GameConfig);

// Handle browser resize events
window.addEventListener('resize', () => {
  if (window.game.isBooted) {
    setTimeout(() => {
      window.game.scale.resize(window.innerWidth, window.innerHeight);
      window.game.canvas.style.width = `${window.innerWidth}px`;
      window.game.canvas.style.height = `${window.innerHeight}px`;
    }, 100);
  }
});

// Ensure the game stays in focus
window.addEventListener('blur', () => {
  // On mobile, keep the audio context running when app loses focus
  if (window.game && window.game.sound && window.game.sound.context) {
    if (window.game.sound.context.state === 'running') {
      window.game.sound.context.resume().catch(err => console.error('Audio context error:', err));
    }
  }
});

// Set up PWA capability for mobile
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(error => {
      // Ignore service worker errors in development
      console.log('Service worker registration skipped in development mode');
    });
  });
}