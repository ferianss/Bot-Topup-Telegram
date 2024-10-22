# Bot-Topup-Telegram

**Bot-Topup-Telegram** is a Telegram bot that allows users to perform top-up transactions directly within Telegram by integrating with the [JF Topup Service API](https://topup.j-f.cloud). This bot enables seamless transactions for purchasing products like mobile game credits, prepaid balances, and more.

## Features

- **Product Ordering**: Order various digital products like game credits, mobile top-ups, etc.
- **Real-time Balance Check**: Automatically checks the balance and notifies if there are insufficient funds.
- **Transaction Status**: Monitor and track the status of your orders directly within the bot.
- **User Registration**: Simple registration and role-based pricing based on user tier (Bronze, Gold, Platinum, VIP).
- **Reward Points**: Earn points based on your orders and accumulate them for special rewards.
- **Anti-Spam System**: Prevents spamming the same order within a set interval.

## Integration with [JF Topup Service API](https://topup.j-f.cloud)

The bot integrates with the JF Topup Service, allowing users to interact with the top-up services offered by [JF Topup Cloud](https://topup.j-f.cloud). This integration includes:

- **Fetching Product Information**: Retrieve available top-up products and their pricing.
- **Submitting Orders**: Send orders for digital products via the JF Topup API.
- **Order Status Monitoring**: Query and display the status of each transaction.

## Getting Started

### Prerequisites

Before setting up the bot, make sure you have the following:

- [Node.js](https://nodejs.org/) installed
- A Telegram bot token (obtainable by talking to [BotFather](https://core.telegram.org/bots#botfather))
- An account with [JF Topup Service](https://topup.j-f.cloud) and your API key

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/ferianss/Bot-Topup-Telegram.git
2. **cd Bot-Topup-Telegram**
3. **Install the dependencies:**
   ```
   npm install
4. **Edit the config.js file in folder db**
5. **Run the bot:**
   ```
   node index.js

**All credits to JF Dev.**
