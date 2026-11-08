# Capricorn

Capricorn is a desktop assistant built with Electron. It uses Groq for its 
conversational model and can use tools such as web search while responding. 
It is based on Project Capricorn from the anime Cyberpunk: Edgerunners 2

## Run Capri (via Release)

1. Download the latest release from the [Releases](https://github.com/AliAhmad-M/Capricorn/releases) page.
2. Extract the downloaded archive and run file: `Capricorn.exe`.
3. Open **Settings** and enter your Groq API key to enable chat.

No Node.js installation or manual dependency setup is required.

---

## Run Capri (via Source Code)

1. Install [Node.js](https://nodejs.org/), which includes npm.
2. Clone the repository and install its dependencies:

   ```sh
   git clone https://github.com/AliAhmad-M/Capricorn.git
   cd Capricorn
   npm install
   ```

3. Create a `.env` file in the project root and configure Groq:

   ```env
   GROQ_API_KEY=your_groq_api_key
   GROQ_TEXT_MODEL=openai/gpt-oss-20b
   GROQ_VOICE_MODEL=whisper-large-v3-turbo
   ```

   Get an API key from [Groq](https://console.groq.com/keys). The same
   `GROQ_API_KEY` is used for chat and voice transcription. Both model variables
   are optional; the defaults are `qwen/qwen3.8-27b` for chat and
   `whisper-large-v3-turbo` for transcription. You can also change the key and
   either model in Settings; saved values override `.env`. Capricorn also has the
   option to add multiple text and voice models (up to 3) for fallback in case one
   fails. Clear a setting and save it to use its default value again.

4. Start the app:

   ```sh
   npm start
   ```

Web search uses DuckDuckGo by default. To use Brave Search instead, add a
`BRAVE_API_KEY` to `.env`. Keep API keys private; `.env` is excluded from Git.

To use voice input, click the microphone once to start recording and click it
again to transcribe and send the recording. A Groq API key is required.
