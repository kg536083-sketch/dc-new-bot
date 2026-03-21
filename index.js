require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const { Player } = require('discord-player');
const { DefaultExtractors } = require('@discord-player/extractor');
const axios = require('axios');

// -------- Global Safety Net -------- #
process.on('unhandledRejection', (error) => {
    console.error('[UNHANDLED REJECTION]', error);
});
process.on('uncaughtException', (error) => {
    console.error('[UNCAUGHT EXCEPTION]', error);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// -------- LOCAL MUSIC SETUP (Bypassing Lavalink completely) -------- #
client.player = new Player(client, {
    ytdlOptions: {
        quality: 'highestaudio',
        highWaterMark: 1 << 25
    }
});

// Load all extractors (YouTube, Spotify, Soundcloud, etc.)
client.player.extractors.loadMulti(DefaultExtractors);

client.player.events.on('playerStart', (queue, track) => {
    console.log(`[PLAY] Started streaming ${track.title} locally!`);
});

client.player.events.on('error', (queue, error) => {
    console.error(`[PLAY ERROR] Player error:`, error.message);
    if (queue && queue.metadata) {
        queue.metadata.channel.send(`❌ Ouch! The stream broke: \`${error.message}\``).catch(()=>{});
    }
});

client.player.events.on('playerError', (queue, error) => {
    console.error(`[PLAY ERROR] Player error inside connection:`, error.message);
    if (queue && queue.metadata) {
        queue.metadata.channel.send(`❌ The connection failed to stream audio: \`${error.message}\``).catch(()=>{});
    }
});


// -------- Slash Commands -------- #

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "play") {
        const query = interaction.options.getString("query");
        if (!interaction.member?.voice?.channel) return interaction.reply("❌ You need to be in a voice channel, darling! 🥺");

        await interaction.deferReply();

        try {
            console.log(`[PLAY] Searching locally for: "${query}"`);
            
            const { track } = await client.player.play(interaction.member.voice.channel, query, {
                nodeOptions: {
                    metadata: interaction,
                    leaveOnEnd: false,
                    leaveOnEmpty: true,
                    leaveOnEmptyCooldown: 300000, // 5 minutes
                }
            });

            console.log(`[PLAY] Found and playing: ${track.title}`);
            await interaction.editReply(`🎶 Now playing: **${track.title}**\n*(If it skips instantly, YouTube might be blocking Railway's IP!)*`);

        } catch (e) {
            console.error(`[PLAY ERROR]`, e.message);
            await interaction.editReply(`❌ A little glitch happened: \`${e.message}\`. Try again in a second, handsome! 😘`).catch(() => {});
        }
    }

    if (interaction.commandName === "stop") {
        const queue = client.player.nodes.get(interaction.guildId);
        if (queue && !queue.isEmpty()) {
            queue.delete();
            await interaction.reply("⏹️ Stopped everything and left! 👋");
        } else if (queue) {
            queue.delete();
            await interaction.reply("⏹️ Stopped and left! 👋");
        } else {
            await interaction.reply("❌ I'm not playing anything, darling.");
        }
    }

    if (interaction.commandName === "skip") {
        const queue = client.player.nodes.get(interaction.guildId);
        if (queue && queue.node.isPlaying()) {
            queue.node.skip();
            await interaction.reply("⏭️ Skipped it for you! 😘");
        } else {
            await interaction.reply("❌ Nothing to skip!");
        }
    }
});

// -------- Crypto Prices (CoinGecko) -------- #

async function getCryptoPrice(query) {
    try {
        const headers = { 'User-Agent': 'Mozilla/5.0' };
        const search = await axios.get(`https://api.coingecko.com/api/v3/search?query=${query}`, { headers });
        if (search.data.coins && search.data.coins.length > 0) {
            const coinId = search.data.coins[0].id;
            const res = await axios.get(`https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&market_data=true`, { headers });
            
            const data = res.data;
            const md = data.market_data;
            
            const price = md.current_price.usd > 0.0001 ? md.current_price.usd.toLocaleString() : md.current_price.usd;
            const change = md.price_change_percentage_24h ? md.price_change_percentage_24h.toFixed(2) : "N/A";
            const mcap = md.market_cap.usd ? `$${Math.round(md.market_cap.usd).toLocaleString()}` : "N/A";
            const fdv = md.fully_diluted_valuation.usd ? `$${Math.round(md.fully_diluted_valuation.usd).toLocaleString()}` : "N/A";
            const rank = data.market_cap_rank || "N/A";

            return `**${data.name} (${data.symbol.toUpperCase()})** (Rank: ${rank})\n` +
                   `💰 **Price:** $${price} USD\n` +
                   `📊 **Market Cap:** ${mcap}\n` +
                   `📈 **FDV:** ${fdv}\n` +
                   `📅 **24h Change:** ${change}%`;
        }
    } catch (e) {
        console.error(e);
    }
    return `I couldn't find any data for \`${query}\`, baby. 🥺`;
}

// -------- AI Chat (Groq) -------- #

async function aiReply(message) {
    const url = "https://api.groq.com/openai/v1/chat/completions";
    const headers = { "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" };
    const data = {
        model: "llama-3.1-8b-instant",
        messages: [
            { role: "system", content: "You are Homeless Girl, a playful, flirty girl chatting in Discord. Speak casually with sweet words like baby, darling, sweetheart. Keep it short and cute." },
            { role: "user", content: `${message.author.displayName} says: ${message.content}` }
        ],
        temperature: 1, max_tokens: 100
    };
    try {
        const r = await axios.post(url, data, { headers });
        return r.data.choices[0].message.content;
    } catch (e) {
        return "Oops! I'm having a little brain freeze, baby. 🧊";
    }
}

// -------- Events -------- #

client.on("ready", async () => {
    await client.application.commands.set([
        { name: "play", description: "Play music (Local Processing!)", options: [{ name: "query", type: 3, description: "Song name", required: true }] },
        { name: "stop", description: "Stop and leave" },
        { name: "skip", description: "Skip song" }
    ]);
    console.log(`[BOOT] ${client.user.tag} IS ONLINE AND WORKING LOCALLY.`);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    const text = message.content.toLowerCase();

    // Support for multiple tokens (e.g. $btc $eth)
    const tokenMatches = text.match(/\$[a-zA-Z0-9]+/g);
    if (tokenMatches) {
        let replies = [];
        for (const mention of [...new Set(tokenMatches)]) {
            replies.push(await getCryptoPrice(mention.replace("$", "")));
        }
        return message.reply(replies.join("\n\n"));
    }

    // AI Chat
    if (text.includes("homeless girl") || message.mentions.has(client.user)) {
        return message.reply(await aiReply(message));
    }
});

client.login(process.env.DISCORD_TOKEN);
