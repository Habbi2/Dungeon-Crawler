import Phaser from 'phaser';
import multiplayerService from '../multiplayer/MultiplayerService';

class UIScene extends Phaser.Scene {
  constructor() {
    super({ key: 'UIScene' });
    
    this.health = 100;
    this.maxHealth = 100;
    this.gold = 0;
    this.inventory = [];
    this.messages = [];
    this.messageTimers = []; // Track timers for each message
    this.connectionStatusText = null;
    this.connectionStatusTimer = null;
  }
  
  create() {
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;
    
    // Create a dedicated UI camera that will stay fixed regardless of game zoom
    this.uiCamera = this.cameras.add(0, 0, width, height);
    this.uiCamera.setScroll(0, 0);
    this.uiCamera.setName('UI Camera');
    
    // Create a UI container that will hold all UI elements
    this.uiContainer = this.add.container(0, 0);
    
    // Create UI containers
    this.createHealthBar(10, 10, 200, 20);
    this.createInventoryPanel(width - 210, 10, 200, 80);
    
    // Position message log below the health bar instead of at bottom of screen
    this.createMessageLog(10, 40, 300, 100);
    
    // Create mobile controls if on touch device
    if (this.sys.game.device.input.touch) {
      this.createMobileControls();
    }
    
    // Set up event listeners from the game scene
    const gameScene = this.scene.get('GameScene');
    
    gameScene.events.on('playerHealthChanged', (health, maxHealth) => {
      this.updateHealth(health, maxHealth);
    });
    
    gameScene.events.on('playerGoldChanged', (gold) => {
      this.updateGold(gold);
    });
    
    gameScene.events.on('playerInventoryChanged', (inventory) => {
      this.updateInventory(inventory);
    });
    
    gameScene.events.on('showMessage', (message) => {
      this.addMessage(message);
    });
    
    // Set up event listener for connection status updates
    multiplayerService.on('connectionStatus', (statusData) => {
      this.showConnectionStatus(statusData.message, statusData.type);
    });
    
    // Also listen for direct socket events to update UI
    multiplayerService.on('connect', () => {
      this.showConnectionStatus('Connected to server', 'success');
    });
    
    multiplayerService.on('disconnect', (data) => {
      this.showConnectionStatus('Disconnected: ' + (data?.reason || 'Unknown'), 'error');
    });
    
    multiplayerService.on('reconnecting', (data) => {
      this.showConnectionStatus('Reconnecting... Attempt ' + (data?.attempt || 1), 'warning');
    });
    
    multiplayerService.on('reconnect', () => {
      this.showConnectionStatus('Reconnected to server', 'success');
    });
    
    multiplayerService.on('error', (error) => {
      this.showConnectionStatus('Connection error: ' + (error?.message || error?.type || 'Unknown'), 'error');
    });
    
    // Create connection status text
    this.createConnectionStatusText();
    
    // Make the UI scene always on top
    this.scene.bringToTop();
  }
  
  createHealthBar(x, y, width, height) {
    // Health bar background
    this.add.rectangle(x, y, width, height, 0x000000)
      .setOrigin(0, 0)
      .setAlpha(0.7);
    
    // The actual health bar
    this.healthBar = this.add.rectangle(x + 2, y + 2, width - 4, height - 4, 0xff0000)
      .setOrigin(0, 0);
    
    // Health text
    this.healthText = this.add.text(x + width / 2, y + height / 2, '100/100', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffffff'
    }).setOrigin(0.5);
  }
  
  createInventoryPanel(x, y, width, height) {
    const screenWidth = this.cameras.main.width;
    const isSmallScreen = screenWidth < 425;
    
    // Adjust panel size and position for small screens
    if (isSmallScreen) {
      width = Math.min(width, screenWidth - 20);
      x = screenWidth - width - 5;
    }
    
    // Panel background
    this.add.rectangle(x, y, width, height, 0x000000)
      .setOrigin(0, 0)
      .setAlpha(0.7);
    
    // Gold display
    this.goldText = this.add.text(x + 10, y + 10, 'Gold: 0', {
      fontFamily: 'monospace',
      fontSize: isSmallScreen ? '12px' : '14px',
      color: '#ffff00'
    });
    
    // Inventory title
    this.add.text(x + 10, y + 30, 'Inventory:', {
      fontFamily: 'monospace',
      fontSize: isSmallScreen ? '12px' : '14px',
      color: '#ffffff'
    });
    
    // Inventory slots
    this.inventorySlots = [];
    const slotSize = isSmallScreen ? 35 : 40;
    const slotSpacing = isSmallScreen ? 37 : 45;
    
    for (let i = 0; i < 4; i++) {
      const slotX = x + 10 + i * slotSpacing;
      const slotY = y + 50;
      
      // Slot background
      const slot = this.add.rectangle(slotX, slotY, slotSize, slotSize, 0x333333)
        .setOrigin(0, 0);
      
      this.inventorySlots.push({
        container: slot,
        icon: null,
        count: null
      });
    }
  }
  
  createMessageLog(x, y, width, height) {
    // Message log background
    this.messageLogBg = this.add.rectangle(x, y, width, height, 0x000000)
      .setOrigin(0, 0)
      .setAlpha(0.7);
    
    // Initially hide the message log background
    this.messageLogBg.setVisible(false);
    
    // Message container
    this.messageContainer = this.add.container(x + 5, y + 5);
    
    // Clip the message container to the message log area
    const shape = this.make.graphics();
    shape.fillRect(x, y, width, height);
    const mask = shape.createGeometryMask();
    this.messageContainer.setMask(mask);
  }
  
  createMobileControls() {
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;
    
    // Make controls adaptive based on screen width
    const isSmallScreen = width < 425;
    
    // Create the directional joystick (left side)
    const joystickRadius = isSmallScreen ? 50 : 60;
    const joystickX = joystickRadius + 20;
    const joystickY = height - joystickRadius - 20;
    
    // Create joystick background
    const joystickBg = this.add.circle(joystickX, joystickY, joystickRadius, 0x000000)
      .setAlpha(0.5)
      .setScrollFactor(0); // Make sure it doesn't move with camera
    
    // Create joystick handle
    const joystickHandle = this.add.circle(joystickX, joystickY, joystickRadius * 0.5, 0x0000ff)
      .setAlpha(0.8)
      .setScrollFactor(0); // Make sure it doesn't move with camera
    
    // Create attack button (right side)
    const attackButtonRadius = isSmallScreen ? 40 : 50;
    const attackX = width - attackButtonRadius - 20;
    const attackY = height - attackButtonRadius - 20;
    
    const attackButton = this.add.circle(attackX, attackY, attackButtonRadius, 0xff0000)
      .setAlpha(0.8)
      .setScrollFactor(0) // Make sure it doesn't move with camera
      .setInteractive();
    
    const attackText = this.add.text(attackX, attackY, 'ATTACK', {
      fontFamily: 'monospace',
      fontSize: isSmallScreen ? '14px' : '16px',
      color: '#ffffff',
    })
      .setOrigin(0.5)
      .setScrollFactor(0); // Make sure it doesn't move with camera
    
    // Position inventory button at top-right
    const inventoryY = isSmallScreen ? 40 : 60;
    const inventoryX = width - (isSmallScreen ? 30 : 40);
    
    const inventoryButton = this.add.circle(
      inventoryX,
      inventoryY,
      isSmallScreen ? 20 : 25,
      0x0000ff,
      0.6
    )
      .setInteractive()
      .setScrollFactor(0); // Make sure it doesn't move with camera
    
    const inventoryText = this.add.text(
      inventoryX,
      inventoryY,
      'I', {
        fontFamily: 'monospace',
        fontSize: isSmallScreen ? '16px' : '18px',
        color: '#ffffff',
        fontWeight: 'bold'
      }
    )
      .setOrigin(0.5)
      .setScrollFactor(0); // Make sure it doesn't move with camera
    
    // Connect events to the game scene
    const gameScene = this.scene.get('GameScene');
    
    // Joystick control
    let joystickActive = false;
    let startX, startY;
    
    // Handle joystick input
    this.input.on('pointerdown', (pointer) => {
      // Check if the pointer is in the left third of the screen (joystick area)
      if (pointer.x < width / 3) {
        joystickActive = true;
        startX = pointer.x;
        startY = pointer.y;
        // Move joystick to touch position
        joystickBg.setPosition(pointer.x, pointer.y);
        joystickHandle.setPosition(pointer.x, pointer.y);
      }
    });
    
    this.input.on('pointermove', (pointer) => {
      if (!joystickActive) return;
      
      const dx = pointer.x - startX;
      const dy = pointer.y - startY;
      const angle = Math.atan2(dy, dx);
      const distance = Math.min(joystickRadius * 0.5, Math.sqrt(dx * dx + dy * dy));
      
      const handleX = startX + distance * Math.cos(angle);
      const handleY = startY + distance * Math.sin(angle);
      joystickHandle.setPosition(handleX, handleY);
      
      // Send movement command to game scene
      if (distance > 10) { // Add deadzone
        const normalizedDx = Math.cos(angle);
        const normalizedDy = Math.sin(angle);
        gameScene.events.emit('joystickMove', { x: normalizedDx, y: normalizedDy });
      } else {
        gameScene.events.emit('joystickMove', { x: 0, y: 0 });
      }
    });
    
    this.input.on('pointerup', () => {
      if (joystickActive) {
        joystickActive = false;
        joystickHandle.setPosition(joystickBg.x, joystickBg.y);
        gameScene.events.emit('joystickMove', { x: 0, y: 0 });
      }
    });
    
    // Attack button
    attackButton.on('pointerdown', () => {
      gameScene.events.emit('playerAttack');
    });
    
    // Inventory button
    inventoryButton.on('pointerdown', () => {
      this.scene.pause('GameScene');
      this.showInventoryPopup();
    });
    
    // Store references to controls
    this.mobileControls = {
      joystickBg,
      joystickHandle,
      attackButton,
      attackText,
      inventoryButton,
      inventoryText
    };
    
    // Make sure all UI elements are fixed to the UI camera
    // and don't move with the game camera
    Object.values(this.mobileControls).forEach(element => {
      this.uiCamera.ignore(element);
      element.setScrollFactor(0);
    });
  }
  
  createConnectionStatusText() {
    // Create connection status text at the top of the screen
    this.connectionStatusText = this.add.text(
      this.cameras.main.width / 2, 
      10, 
      '', 
      {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffffff',
        backgroundColor: '#000000',
        padding: { x: 8, y: 4 }
      }
    )
      .setOrigin(0.5, 0)
      .setAlpha(0.9)
      .setScrollFactor(0)
      .setDepth(1000)
      .setVisible(false);
  }
  
  showConnectionStatus(message, type = 'info', duration = 5000) {
    // Set color based on type
    let textColor;
    switch(type) {
      case 'success':
        textColor = '#00ff00';
        break;
      case 'error':
        textColor = '#ff0000';
        break;
      case 'warning':
        textColor = '#ffff00';
        break;
      default:
        textColor = '#ffffff';
    }
    
    // Update the text
    this.connectionStatusText.setText(message);
    this.connectionStatusText.setColor(textColor);
    this.connectionStatusText.setVisible(true);
    
    // Center it horizontally
    this.connectionStatusText.x = this.cameras.main.width / 2;
    
    // Clear existing timer if there is one
    if (this.connectionStatusTimer) {
      this.connectionStatusTimer.remove();
    }
    
    // Set a timer to hide the text if duration > 0
    if (duration > 0) {
      this.connectionStatusTimer = this.time.delayedCall(duration, () => {
        if (this.connectionStatusText) {
          this.connectionStatusText.setVisible(false);
        }
      });
    }
    
    // Add to message log as well
    this.addMessage(message);
  }
  
  updateHealth(health, maxHealth) {
    this.health = health;
    this.maxHealth = maxHealth;
    
    // Update health bar width
    const healthPercentage = health / maxHealth;
    const barWidth = 196 * healthPercentage; // 200 - 4 for padding
    this.healthBar.width = barWidth;
    
    // Update health text
    this.healthText.setText(`${health}/${maxHealth}`);
  }
  
  updateGold(gold) {
    this.gold = gold;
    this.goldText.setText(`Gold: ${gold}`);
  }
  
  updateInventory(inventory) {
    this.inventory = inventory;
    
    // Clear all slots first
    this.inventorySlots.forEach(slot => {
      if (slot.icon) slot.icon.destroy();
      if (slot.count) slot.count.destroy();
      slot.icon = null;
      slot.count = null;
    });
    
    // Populate slots with inventory items
    inventory.forEach((item, index) => {
      if (index >= this.inventorySlots.length) return; // Skip if we have more items than slots
      
      const slot = this.inventorySlots[index];
      const slotX = slot.container.x;
      const slotY = slot.container.y;
      
      // Add item icon (placeholder for now)
      slot.icon = this.add.rectangle(slotX + 20, slotY + 20, 30, 30, this.getItemColor(item.type))
        .setOrigin(0.5);
      
      // Add count for stackable items
      if (item.count > 1) {
        slot.count = this.add.text(slotX + 30, slotY + 30, item.count, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#ffffff'
        });
      }
    });
  }
  
  addMessage(message) {
    // No need to add empty messages
    if (!message || message === '') return;
    
    // Show the message log background when we have messages
    this.messageLogBg.setVisible(true);
    
    // Add new message to the array with timestamp
    const newMessage = {
      text: message,
      time: Date.now()
    };
    
    this.messages.push(newMessage);
    
    // Limit to the last 4 messages
    if (this.messages.length > 4) {
      this.messages.shift();
    }
    
    // Clear old message texts
    this.messageContainer.removeAll();
    
    // Add message texts
    this.messages.forEach((msg, i) => {
      const textObj = this.add.text(0, i * 20, msg.text, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#ffffff'
      });
      
      this.messageContainer.add(textObj);
    });
    
    // Create a timer for this message
    const timer = this.time.delayedCall(3000, () => {
      this.removeOldestMessage();
    });
    
    // Store the timer reference
    this.messageTimers.push(timer);
  }
  
  removeOldestMessage() {
    // Remove the oldest message if there are any
    if (this.messages.length > 0) {
      this.messages.shift();
      
      // Remove the oldest timer as well
      if (this.messageTimers.length > 0) {
        this.messageTimers.shift();
      }
      
      // Clear and redraw the message container
      this.messageContainer.removeAll();
      
      this.messages.forEach((msg, i) => {
        const textObj = this.add.text(0, i * 20, msg.text, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#ffffff'
        });
        
        this.messageContainer.add(textObj);
      });
      
      // Hide the message log background when no messages
      if (this.messages.length === 0) {
        this.messageLogBg.setVisible(false);
      }
    }
  }
  
  showInventoryPopup() {
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;
    const isSmallScreen = width < 425;
    
    // Scale down popup size for small screens
    const panelWidth = isSmallScreen ? Math.min(width * 0.9, 300) : 400;
    const panelHeight = isSmallScreen ? Math.min(height * 0.8, 250) : 300;
    
    // Create a modal popup for the inventory
    const panel = this.add.rectangle(width / 2, height / 2, panelWidth, panelHeight, 0x000000)
      .setOrigin(0.5)
      .setAlpha(0.9);
    
    const title = this.add.text(width / 2, height / 2 - (isSmallScreen ? panelHeight * 0.4 : 130), 'INVENTORY', {
      fontFamily: 'monospace',
      fontSize: isSmallScreen ? '18px' : '24px',
      color: '#ffffff'
    }).setOrigin(0.5);
    
    // Item slots
    const itemsPerRow = isSmallScreen ? 3 : 4;
    const slotSize = isSmallScreen ? 40 : 50;
    const startX = width / 2 - (itemsPerRow * slotSize) / 2;
    const startY = height / 2 - (isSmallScreen ? 60 : 80);
    
    // Limit to 2 rows on small screens to avoid overcrowding
    const maxSlots = isSmallScreen ? 6 : 12;
    
    for (let i = 0; i < maxSlots; i++) { // Rows of slots
      const row = Math.floor(i / itemsPerRow);
      const col = i % itemsPerRow;
      
      const slotX = startX + col * slotSize;
      const slotY = startY + row * slotSize;
      
      // Slot background
      this.add.rectangle(slotX, slotY, isSmallScreen ? 35 : 40, isSmallScreen ? 35 : 40, 0x333333)
        .setOrigin(0, 0);
      
      // Add item if available
      if (i < this.inventory.length) {
        const item = this.inventory[i];
        
        // Item icon
        const icon = this.add.rectangle(
          slotX + (isSmallScreen ? 17.5 : 20), 
          slotY + (isSmallScreen ? 17.5 : 20), 
          isSmallScreen ? 25 : 30, 
          isSmallScreen ? 25 : 30, 
          this.getItemColor(item.type)
        )
          .setOrigin(0.5)
          .setInteractive()
          .on('pointerdown', () => {
            // Use the item
            this.scene.get('GameScene').events.emit('useItem', i);
            // Close inventory
            this.closeInventoryPopup();
          });
        
        // Item count
        if (item.count > 1) {
          this.add.text(
            slotX + (isSmallScreen ? 27 : 30), 
            slotY + (isSmallScreen ? 27 : 30), 
            item.count, {
              fontFamily: 'monospace',
              fontSize: isSmallScreen ? '10px' : '12px',
              color: '#ffffff'
            }
          );
        }
      }
    }
    
    // Close button
    const closeButton = this.add.text(
      width / 2, 
      height / 2 + (isSmallScreen ? panelHeight * 0.35 : 120), 
      'CLOSE', {
        fontFamily: 'monospace',
        fontSize: isSmallScreen ? '16px' : '18px',
        color: '#ffffff',
        backgroundColor: '#880000',
        padding: { x: 10, y: 5 }
      }
    )
    .setOrigin(0.5)
    .setInteractive()
    .on('pointerdown', () => {
      this.closeInventoryPopup();
    });
    
    // Store UI elements for later removal
    this.inventoryPopup = {
      panel,
      title,
      closeButton,
      isOpen: true
    };
  }
  
  closeInventoryPopup() {
    if (this.inventoryPopup && this.inventoryPopup.isOpen) {
      this.inventoryPopup.panel.destroy();
      this.inventoryPopup.title.destroy();
      this.inventoryPopup.closeButton.destroy();
      this.inventoryPopup.isOpen = false;
      
      // Resume the game scene
      this.scene.resume('GameScene');
    }
  }
  
  getItemColor(itemType) {
    // Return a color based on item type
    switch(itemType) {
      case 'health_potion':
        return 0xff0000;
      case 'weapon':
        return 0xcccccc;
      case 'armor':
        return 0x0000ff;
      case 'key':
        return 0xffff00;
      default:
        return 0x00ff00;
    }
  }
}

export default UIScene;