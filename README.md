# Bot-Topup-Telegram

**Bot-Topup-Telegram** is a Telegram bot that allows users to perform top-up transactions directly within Telegram by integrating with the [JF Store API](https://topup.j-f.cloud/api/docs). This bot enables seamless transactions for purchasing products like mobile game credits, prepaid balances, and more.

## Features

- **Product Ordering**: Order various digital products like game credits, mobile top-ups, etc.
- **Real-time Balance Check**: Automatically checks the balance and notifies if there are insufficient funds.
- **Transaction Status**: Monitor and track the status of your orders directly within the bot.
- **User Registration**: Simple registration and role-based pricing based on user tier (Bronze, Gold, Platinum, VIP).
- **And more.**

## Integration with [JF Store](https://topup.j-f.cloud) and [Medanpedia](https://medanpedia.co.id/)

The bot integrates with the JF Topup Service, allowing users to interact with the top-up services offered by [JF Store](https://topup.j-f.cloud). This integration includes:

- **Fetching Product Information**: Retrieve available top-up products and their pricing.
- **Submitting Orders**: Send orders for digital products via the JF Topup API.
- **Order Status Monitoring**: Query and display the status of each transaction.

## Getting Started

### Prerequisites

Before setting up the bot, make sure you have the following:

- [Node.js](https://nodejs.org/) installed
- A Telegram bot token (obtainable by talking to [BotFather](https://t.me/@BotFather))
- An account with [JF Store](https://topup.j-f.cloud/api/docs) and your API key
- **Your IP address must be whitelisted** in order for the bot to operate. Please ensure your IP is added to the allowed list to prevent unauthorized access.

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
