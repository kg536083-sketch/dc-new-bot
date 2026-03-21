require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const { LavalinkManager } = require('lavalink-client');
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

// -------- Lavalink Setup (Redundant Nodes for Stability) -------- #
const nodes = [
    {
        id: "Serenetia",
        host: "lavalinkv4.serenetia.com",
        port: 443,
        authorization: "https://seretia.link/discord",
        secure: true,
        requestSignalTimeoutMS: 30000
    },
    {
        id: "AneFaiz",
        host: "lava-v4.millohost.my.id",
        port: 443,
        authorization: "https://discord.gg/mjS5J2K3ep",
        secure: true,
        requestSignalTimeoutMS: 30000
    },
    {
        id: "Jirayu",
        host: "lavalink.jirayu.net",
        port: 443,
        authorization: "youshallnotpass",
        secure: true,
        requestSignalTimeoutMS: 30000
    },
    {
        id: "TriniumHost",
        host: "lavalink-v4.triniumhost.com",
        port: 443,
        authorization: "free",
        secure: true,
        requestSignalTimeoutMS: 30000
    }
];

client.lavalink = new LavalinkManager({
    nodes: nodes,
    sendToShard: (guildId, payload) => {
        client.guilds.cache.get(guildId)?.shard?.send(payload);
    },
    autoSkip: true, // Automatically play the next song in the queue
    client: {
        id: "", // Will be auto-set on ready
        username: "Homeless Girl"
    }
});

// -------- Node Event Logs -------- #
client.lavalink.nodeManager.on("connect", (node) => {
    console.log(`[LAVALINK] Node "${node.id}" connected! Version: ${node.version}`);
});

client.lavalink.nodeManager.on("disconnect", (node, reason) => {
    console.log(`[LAVALINK] Node "${node.id}" disconnected! Reason:`, reason);
});

client.lavalink.nodeManager.on("error", (node, error) => {
    console.error(`[LAVALINK] Node "${node.id}" error:`, error.message || error);
});

client.lavalink.nodeManager.on("reconnecting", (node) => {
    console.log(`[LAVALINK] Node "${node.id}" reconnecting...`);
});


// -------- Slash Commands -------- #

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "play") {
        const query = interaction.options.getString("query");
        if (!interaction.member?.voice?.channel) return interaction.reply("❌ You need to be in a voice channel, darling! 🥺");

        await interaction.deferReply();

        try {
            // Step 1: Check connected nodes
            const connectedNodes = [...client.lavalink.nodeManager.nodes.values()].filter(n => n.connected);
            console.log(`[PLAY] Connected nodes: ${connectedNodes.map(n => n.id).join(", ") || "NONE"}`);
            
            if (connectedNodes.length === 0) {
                return interaction.editReply("❌ No Lavalink nodes are connected right now. Try again in a moment, baby! 🥺");
            }

            // Step 2: Get or create player
            let player = client.lavalink.getPlayer(interaction.guildId);
            if (!player) {
                console.log(`[PLAY] Creating new player for guild ${interaction.guildId}`);
                player = await client.lavalink.createPlayer({
                    guildId: interaction.guildId,
                    voiceChannelId: interaction.member.voice.channelId,
                    textChannelId: interaction.channelId,
                    selfDeaf: true
                });
            }
            console.log(`[PLAY] Player node: ${player.node?.id || "NO NODE"}`);

            const withTimeout = (promise, ms, errorMessage) => {
                let timeoutId;
                const timeoutPromise = new Promise((_, reject) => {
                    timeoutId = setTimeout(() => reject(new Error(errorMessage)), ms);
                });
                promise.catch(() => {}); // Prevent unhandled rejections if the original promise fails after timeout
                return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
            };

            // Step 3: Connect to voice
            if (!player.connected) {
                console.log(`[PLAY] Connecting to voice channel...`);
                await withTimeout(player.connect(), 10000, "Connecting to voice channel timed out");
                console.log(`[PLAY] Voice connected!`);
            }

            // Step 4: Search
            console.log(`[PLAY] Searching for: "${query}" on node: ${player.node?.id}`);
            const searchStart = Date.now();
            const res = await withTimeout(player.search({ query: query }, interaction.user), 30000, "Search timed out (30s)");
            console.log(`[PLAY] Search completed in ${Date.now() - searchStart}ms, loadType: ${res?.loadType}, tracks: ${res?.tracks?.length}`);

            if (!res || !res.tracks || !res.tracks.length) return interaction.editReply("❌ I couldn't find that song, baby. 🥺");

            const track = res.tracks[0];
            player.queue.add(track);

            // Step 5: Play
            if (!player.playing) {
                console.log(`[PLAY] Starting playback of: ${track.info.title}`);
                const playStart = Date.now();
                await withTimeout(player.play(), 30000, "Starting playback timed out (30s)");
                console.log(`[PLAY] Playback started in ${Date.now() - playStart}ms`);
            }
            await interaction.editReply(`🎶 Now playing: **${track.info.title}**`);

        } catch (e) {
            console.error(`[PLAY ERROR]`, e.message, e.stack);
            try {
                const player = client.lavalink.getPlayer(interaction.guildId);
                if (player && !player.playing) await player.destroy().catch(() => {});
            } catch(_) {}
            await interaction.editReply(`❌ A little glitch happened: \`${e.message}\`. Try again in a second, handsome! 😘`).catch(() => {});
        }
    }

    if (interaction.commandName === "stop") {
        const player = client.lavalink.getPlayer(interaction.guildId);
        if (player) {
            await player.destroy();
            await interaction.reply("⏹️ Stopped everything and left! 👋");
        } else {
            await interaction.reply("❌ I'm not playing anything, darling.");
        }
    }

    if (interaction.commandName === "skip") {
        const player = client.lavalink.getPlayer(interaction.guildId);
        if (player && player.playing) {
            await player.skip();
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
    client.lavalink.options.client.id = client.user.id;
    // CRITICAL: Initialize Lavalink Client to connect to nodes!
    client.lavalink.init({ id: client.user.id, username: client.user.username });
    await client.application.commands.set([
        { name: "play", description: "Play music (Redundant Technology)", options: [{ name: "query", type: 3, description: "Song name", required: true }] },
        { name: "stop", description: "Stop and leave" },
        { name: "skip", description: "Skip song" }
    ]);
    console.log(`[BOOT] ${client.user.tag} IS ONLINE AND WORKING.`);
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

// Sync voice state with Lavalink
client.on("raw", (d) => client.lavalink.sendRawData(d));

client.login(process.env.DISCORD_TOKEN);
