# Capricorn

Capricorn is a desktop assistant built with Electron. It uses Groq for its 
conversational model and can use tools such as web search while responding. 
It is based on Project Capricorn from the anime Cyberpunk: Edgerunners 2

## Run Capri (via Release)

1. Download the latest release from the [Releases](https://github.com/AliAhmad-M/Capricorn/releases) page.
2. Extract the downloaded archive and run file: `Capricorn.exe`.
3. Open **Settings** and enter your Groq API key to enable chat.
4. Optional: add a Fish Audio API key in **Settings** to have Capri speak her replies.

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

3. Create a `.env` file in the project root and configure it. Only
   `GROQ_API_KEY` is required, and everything else is optional:

   ```env
   GROQ_API_KEY=your_groq_api_key
   GROQ_TEXT_MODEL=openai/gpt-oss-20b
   GROQ_VOICE_MODEL=whisper-large-v3-turbo

   # Optional: voice output
   FISH_AUDIO_API_KEY=your_fish_audio_api_key
   FISH_AUDIO_VOICE_ID=your_fish_audio_voice_id
   FISH_AUDIO_TTS_MODEL=s2.1-pro-free
   ```

   - **Groq:** Get an API key from [Groq](https://console.groq.com/keys). The
     same `GROQ_API_KEY` is used for chat and voice transcription. The defaults
     are `qwen/qwen3.8-27b` for chat and `whisper-large-v3-turbo` for
     transcription.

   - **Fish Audio:** Capri can read her replies aloud using
     [Fish Audio](https://fish.audio/). Set `FISH_AUDIO_API_KEY` in `.env`, or
     add the key in **Settings** under **Fish Audio API key**. Spoken responses
     use Capri's default voice and the `s2.1-pro-free` speech model unless you
     set `FISH_AUDIO_VOICE_ID` or `FISH_AUDIO_TTS_MODEL` (or enter a **Fish
     Audio Voice ID** in Settings).

   - **Model fallback:** In Settings you can add up to 3 text, voice and TTS
     (speech) models for fallback in case one fails. In `.env`, list several
     models separated by commas, in priority order, for example
     `GROQ_TEXT_MODEL=model-one,model-two`.

   - **Settings and defaults:** You can change any of these in Settings. Saved
     values override `.env`. Clear a setting and save it to use its default
     value again.
     
4. Start the app:

   ```sh
   npm start
   ```

Web search uses DuckDuckGo by default. To use Brave Search instead, add a
Brave API key in **Settings** (under **Brave API key**) or set `BRAVE_API_KEY`
in `.env`. Keep API keys private; `.env` is excluded from Git.
