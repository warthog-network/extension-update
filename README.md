# Warthog Wallet Extension

**NOTE FOR REVIEWERS :** [Build Instruction](#-installation)

The **Warthog Wallet Extension** is a feature-rich browser extension for seamless interaction with the **Warthog Network**. Built for modern browsers, it provides a secure, efficient, and user-friendly interface for managing your Warthog assets.

---

## 🚀 Features

- **⚡ Modern Tech Stack**: Built with **React.js 18.3.1** and **TypeScript** for a robust and scalable architecture.
- **🎨 Tailwind CSS**: Ensures a sleek and responsive design for all screen sizes.
- **🔒 Secure**: Optimized for privacy and secure data handling.
- **🌐 Mainnet + DeFi testnet**: Official mainnet node (same as website webwallet) plus DeFi testnet presets from wartbunker (`wart_balance`, dual transfer payloads).
- **🧪 DeFi hub (testnet)**: Assets (watch/create/send/search), DEX (limit orders, LP deposit/withdraw, market), open orders + cancel, fake mine — core wartbunker functions when a DeFi node is selected.
- **📜 Activity**: Account history from the connected node (when supported).
- **💱 USD price**: Multi-source WART price with cache (CoinGecko → CoinPaprika).
- **🔑 Website-compatible login**: Create, seed derive, private key, saved wallet, wallet file.
- **📱 Fully Responsive**: Offers a seamless experience across devices.

---

## 📦 Installation

Follow these steps to install and run the Warthog Wallet Extension:

1. Clone the repository:

   ```bash
   git clone https://github.com/warthog-network/warthog-extension.git

   cd warthog-wallet-extension
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Set up environment variables:

   ```bash
   cp .env.sample .env
   ```

   Edit `.env` file with your values.

4. Start the development server:

   ```bash
   npm run dev
   ```

5. Build the extension for production:

   ```bash
   npm run build
   ```

---

## ⚙️ Environment Variables

Create a `.env` file from `.env.sample`:

- **VITE_APP_ENCRYPTION_KEY**: Encryption key for secure data
- **VITE_APP_COINGECKO_API_URL**: CoinGecko API for WART price (USD)
- **VITE_APP_XEGGEX_API_URL**: Legacy Xeggex API (deprecated)

---

## 📄 Manifest Files

The extension's configuration is managed by the `public/manifest.json` file. This file defines key settings such as permissions, browser compatibility, and entry points.

To build and package the extension, run:

```bash
npm run build
```

---

## 🧑‍💻 Usage Instructions

### Load the Extension in Chrome Developer Mode

1. Navigate to the Extension Management page:

   - Open `chrome://extensions` in your browser.
   - Alternatively, access it via the Chrome menu: `More Tools > Extensions`.

2. Enable **Developer Mode**:

   - Toggle the **Developer mode** switch at the top-right of the Extensions page.

3. Load the unpacked extension:
   - Click the **Load unpacked** button.
   - Select the `build` folder from the project directory.

The extension will now be loaded and ready for use.

---

## 🛠️ Development Notes

- Ensure you’re using Node.js **22.x or higher**.
- Follow the coding standards defined in the project’s `.eslintrc` and `.prettierrc` configuration files.

---

## 📚 Resources & Documentation

Explore additional resources to enhance your development experience:

- [Chrome Extension Developer Guide](https://developer.chrome.com/docs/extensions/mv3/getstarted/)
- [React.js Documentation](https://reactjs.org/docs/getting-started.html)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
