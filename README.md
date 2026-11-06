# Capricorn

Capricorn is a desktop assistant built with Electron. It uses Groq for its conversational model and can use tools such as web search while responding. 
It is based on Project Capricorn from the anime Cyberpunk: Edgerunners 2

## Run Capri

1. Install [Node.js](https://nodejs.org/), which includes npm.
2. Clone the repository and install its dependencies:

   ```sh
   git clone https://github.com/AliAhmad-M/Capricorn.git
   cd Capricorn
   npm install
   ```

3. Create a `.env` file in the project root and add your Groq API key and model:

   ```env
   GROQ_API_KEY=your_groq_api_key
   GROQ_MODEL=your_model
   ```

   Get an API key from [Groq](https://console.groq.com/keys). `GROQ_MODEL` is
   optional; if omitted, Capri uses `llama-3.3-70b-versatile`.

4. Start the app:

   ```sh
   npm start
   ```

Web search uses DuckDuckGo by default. To use Brave Search instead, add a
`BRAVE_API_KEY` to `.env`. Keep API keys private; `.env` is excluded from Git.
