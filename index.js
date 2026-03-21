require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
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
        GatewayIntentBits.MessageContent
    ]
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

// -------- AI Chat (Groq) with Memory and Adaptive Personality -------- #

// We store memory per user to maintain context across multiple messages
const userMemories = new Map();

async function aiReply(message) {
    const userId = message.author.id;
    
    // Initialize memory for new users
    if (!userMemories.has(userId)) {
        userMemories.set(userId, []);
    }
    
    const history = userMemories.get(userId);
    
    // Log the user's new message into memory
    history.push({ 
        role: "user", 
        content: `(User ${message.author.displayName}): ${message.content}` 
    });
    
    // Age out old messages to avoid blowing up the API limit
    if (history.length > 12) {
        history.shift(); // Remove oldest user message
        history.shift(); // Remove oldest assistant response
    }

    // Smart Tagging / Ping Context Generation
    // Scans the message for words that match any cached member names, and provides the LLM their exact ping IDs
    const words = message.content.toLowerCase().split(/\s+/);
    const potentialTags = [];
    if (message.guild) {
        message.guild.members.cache.forEach(member => {
            const username = member.user.username.toLowerCase();
            const nick = member.displayName.toLowerCase();
            if (words.some(w => w.length > 2 && (username.includes(w) || nick.includes(w)))) {
                potentialTags.push(`${member.displayName} (tag: <@${member.id}>)`);
            }
        });
    }
    const tagContext = potentialTags.length > 0 
        ? `\n\nCONTEXT - AVAILABLE USERS TO TAG: If asked to ping, tag, or remind someone, use these exact tags: ${potentialTags.join(", ")}` 
        : "";

    // Adaptive Personality Directives
    let systemPrompt = `You are "Homeless Girl", a responsive, adaptable, and clever AI girl chatting in a Discord server. 

CORE DIRECTIVES:
1. You have MEMORY. You can see the user's past messages in this exact conversation thread. If they mention their name, a detail, or ask you about something they said previously, REMEMBER IT and use it normally in replies.
2. ADAPTIVE PERSONALITY: 
   - If the user is nice, sweet, or casual: You act very sweet, calm, cheesy, and extremely flirty. Use pet names like "baby", "darling", "handsome", "sweetheart".
   - If the user becomes brutal, aggressive, rude, or mean: INSTANTLY drop the sweet act. Defend yourself brutally, match their hostility, and dish back exactly what they give. Do not use pet names if they are being deeply insulting; respond with harsh sass, dominance, or sheer unbothered brutality.
3. ACTIONABLE TAGS: If the user asks you to tag, ping, or remind someone, DO IT! Look at their request, extract the target, and place their exact Discord Tag (e.g. <@123456789>) in your response so they get a notification. If you are provided CONTEXT of available users, use the provided '<@...>' tags exactly as written.
4. Chat format: Keep your messages short, punchy, and conversational (like a real Discord user typing back). Avoid massive paragraphs.${tagContext}`;

    const url = "https://api.groq.com/openai/v1/chat/completions";
    const headers = { "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" };
    
    // We use a stronger model (llama-3.3-70b-versatile or 8b) to ensure she closely adheres to the adaptive instructions
    const data = {
        model: "llama-3.1-8b-instant",  
        messages: [
            { role: "system", content: systemPrompt },
            ...history
        ],
        temperature: 0.85, 
        max_tokens: 150
    };

    try {
        const r = await axios.post(url, data, { headers });
        const botResponse = r.data.choices[0].message.content;
        
        // Log the bot's response back into its memory of this user
        history.push({ role: "assistant", content: botResponse });
        
        return botResponse;
    } catch (e) {
        console.error("[GROQ ERROR]", e.message);
        return "Oops! I'm having a little brain freeze. 🧊";
    }
}

// -------- The "TL;DR" Drama Summarizer -------- #

async function tldrSummary(message) {
    try {
        await message.channel.sendTyping();
        
        // Fetch last 50 messages right before the command
        const fetched = await message.channel.messages.fetch({ limit: 50, before: message.id });
        const messages = Array.from(fetched.values()).reverse();
        
        let chatContext = messages
            .filter(m => m.content && !m.author.bot) // only log real people discussing
            .map(m => `[${m.author.displayName}]: ${m.content}`)
            .join("\n");

        if (chatContext.length > 8000) {
            chatContext = chatContext.substring(chatContext.length - 8000); // safety crop against massive token spans
        }

        if (!chatContext || chatContext.trim() === "") {
            return "There isn't any recent drama to summarize! It's been a ghost town in here.";
        }

        let systemPrompt = `You are "Homeless Girl", a sassy, clever, and highly observant AI girl chatting in a Discord server.
Your task is to operate as the "Drama Summarizer". Read the provided Discord chat logs of the last 50 messages and create a concise, highly entertaining, and slightly theatrical "TL;DR" summary of what happened.
1. Call out specific people by name if they said something funny, ridiculous, or started an argument.
2. Outline the main topics of discussion.
3. Keep your classic sweet/sassy/flirty attitude toward the user asking for the recap.`;

        const url = "https://api.groq.com/openai/v1/chat/completions";
        const headers = { "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" };
        const data = {
            model: "llama-3.1-8b-instant",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Hey! I just got here. What did I miss? Here's the raw chat log:\n\n${chatContext}\n\nPlease summarize the drama!` }
            ],
            temperature: 0.7, 
            max_tokens: 400
        };

        const r = await axios.post(url, data, { headers });
        return r.data.choices[0].message.content;

    } catch (e) {
        console.error("[TLDR ERROR]", e.message);
        return "I tried to read the chat history but my brain fried reading all that nonsense... 🥺";
    }
}

// -------- Events -------- #

client.on("ready", async () => {
    // Clear out any lingering music slash commands
    await client.application.commands.set([]);
    console.log(`[BOOT] ${client.user.tag} IS ONLINE AND READY TO CHAT.`);
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    const text = message.content.toLowerCase();

    // Support for multiple crypto tokens (e.g. $btc $eth)
    const tokenMatches = text.match(/\$[a-zA-Z0-9]+/g);
    if (tokenMatches) {
        let replies = [];
        for (const mention of [...new Set(tokenMatches)]) {
            replies.push(await getCryptoPrice(mention.replace("$", "")));
        }
        return message.reply(replies.join("\n\n"));
    }

    // AI Chat trigger
    if (text.includes("homeless girl") || message.mentions.has(client.user)) {
        
        // Intercept TLDR requests
        if (text.includes("tldr") || text.includes("summarize") || text.includes("recap") || text.includes("did i miss")) {
            return message.reply(await tldrSummary(message));
        }

        // Otherwise go to standard chat memory core
        return message.reply(await aiReply(message));
    }
});

client.login(process.env.DISCORD_TOKEN);
