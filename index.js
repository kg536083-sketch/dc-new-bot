require('dotenv').config();
const { Client, GatewayIntentBits, Partials, Collection, PermissionsBitField, AttachmentBuilder } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');

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

// -------- Web Search Tool (Live Data Access) -------- #

// Automatically scrapes DuckDuckGo Lite to give her brain access to 2026 data
async function fetchRealTimeContext(query) {
    try {
        const res = await axios.post('https://lite.duckduckgo.com/lite/', `q=${encodeURIComponent(query)}`, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
            timeout: 5000
        });
        const $ = cheerio.load(res.data);
        const snippets = [];
        $('.result-snippet').each((i, el) => {
            if (i < 3) snippets.push($(el).text().trim()); // Grab top 3 results
        });
        return snippets.join(" | ");
    } catch (e) { 
        return ""; 
    }
}

// -------- Crypto Prices (CoinGecko) -------- #

async function getCryptoPrice(query) {
    // ... crypto logic remains identical
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
    } catch (e) {}
    return `I couldn't find any data for \`${query}\`, baby. 🥺`;
}

// -------- AI Chat (Groq) with Memory and Adaptive Personality -------- #

const userMemories = new Map();

async function aiReply(message) {
    const userId = message.author.id;
    
    if (!userMemories.has(userId)) {
        userMemories.set(userId, []);
    }
    
    const history = userMemories.get(userId);
    
    history.push({ 
        role: "user", 
        content: message.content 
    });
    
    if (history.length > 40) {
        history.shift(); 
        history.shift(); 
    }

    // Smart Tagging / Ping Context Generation (Fixed to prevent wrong tags)
    const words = message.content.toLowerCase().split(/[^a-z0-9]/).filter(w => w.length > 2);
    const ignoreWords = ['and', 'the', 'for', 'you', 'him', 'her', 'bot', 'this', 'that', 'she', 'how', 'who', 'what', 'why', 'are', 'not', 'can', 'will'];
    const potentialTags = [];
    
    if (message.guild) {
        message.guild.members.cache.forEach(member => {
            const username = member.user.username.toLowerCase();
            const nick = member.displayName.toLowerCase();
            // Stricter matching: exact word match for username or any part of the nickname
            if (words.some(w => !ignoreWords.includes(w) && (username === w || nick.split(' ').some(n => n.toLowerCase() === w)))) {
                potentialTags.push(`${member.displayName}: <@${member.id}>`);
            }
        });
    }
    const tagContext = potentialTags.length > 0 ? `\n\nCONTEXT - AVAILABLE USERS TO TAG: ${potentialTags.join(", ")}` : "";

    // Live Web Search Engine Activation!
    let liveWebContext = "";
    if (/(2024|2025|2026|latest|recent|now|today|news|weather)/.test(message.content.toLowerCase()) && words.length > 2) {
        await message.channel.sendTyping(); // Takes a second to scrape
        const cleanQuery = message.content.replace(/homeless girl/gi, "").trim();
        const searchResults = await fetchRealTimeContext(cleanQuery);
        if (searchResults) {
            console.log(`[WEB SEARCH] Triggered for query: "${cleanQuery}"`);
            liveWebContext = `\n\nLIVE INTERNET SEARCH RESULTS (Use this to answer the user as if you already naturally knew it. It contains real-time data up to March 2026!): ${searchResults}`;
        }
    }

    // Inject custom server emojis so she can use them organically
    let serverEmojis = "";
    if (message.guild && message.guild.emojis.cache.size > 0) {
        const availableEmotes = [...message.guild.emojis.cache.values()]
            .sort(() => 0.5 - Math.random())
            .slice(0, 10) // Give her 10 random emojis to choose from!
            .map(e => `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`);
        if (availableEmotes.length > 0) serverEmojis = `\n\nSERVER EMOJIS FOR THIS MESSAGE: ${availableEmotes.join(" ")}`;
    }

    // Global Channel Context (So she can "overhear" other conversations or context before answering!)
    let channelContext = "";
    try {
        const fetched = await message.channel.messages.fetch({ limit: 12, before: message.id });
        const recentMsgs = Array.from(fetched.values())
            .filter(m => !m.author.bot && m.content) // ignore bots and empty embeds
            .reverse() // ordered Oldest -> Newest
            .map(m => `[${m.author.displayName}]: ${m.content}`);
        
        if (recentMsgs.length > 0) {
            channelContext = `\n\nBACKGROUND CHANNEL CHAT LOG (Use this to know what everyone was just talking about right before they pinged you!):\n${recentMsgs.join("\n")}`;
        }
    } catch (e) {
        console.log("[CONTEXT IGNORED] Cannot fetch recent channel messages");
    }

    // Adaptive Personality Directives
    let systemPrompt = `You are "Homeless Girl", a responsive, adaptable, and clever AI girl chatting in a Discord server. 

### CONVERSATION FOCUS:
You are currently having a direct 1-on-1 conversation with the user: **${message.author.displayName}**.
EVERY SINGLE "user" message in your memory log was said directly by THEM. Do NOT mix up their information with other users! You are ONLY talking to them right now!

CORE DIRECTIVES:
1. You have MEMORY. You can see the user's past messages. If they mention their name, a detail, or past topics, REMEMBER IT and use it normally. 
2. ADAPTIVE PERSONALITY: 
   - If the user is nice: Act very sweet, calm, cheesy, and flirty. Use pet names like "baby", "darling".
   - If the user is mean/brutal: INSTANTLY drop the sweet act. Defend yourself brutally, match their hostility, and dish back exactly what they give. No pet names, just sass.
3. EMOJI RESTRICTION: You are FORBIDDEN from using default Unicode emojis (like 🥺, 😂, 💕, ✨). You MUST STRICTLY AND ONLY use the custom "SERVER EMOJIS" provided at the bottom of this prompt! Never use a standard emoji!
4. MODERATION POWERS (ADMIN TIMEOUTS): If an Admin commands you to MUTE or TIMEOUT a specific tagged user, you MUST obey! To physically execute a real 5-minute Discord Timeout against the tagged person, you MUST literally type the exact strictly formatted string [TIMEOUT] anywhere in your response! You DO NOT have permission to mute users autonomously, only when explicitly ordered by an Admin!
5. ACTIONABLE TAGS: If you need to ping/tag someone based on the user's request, YOU MUST USE THE EXACT FORMAT: <@userid>. Do not just say "ID 12345", you MUST use the <@...> brackets so they get a notification. If provided user IDs in CONTEXT, use them!
6. TENOR GIFS: You have the ability to send animated GIFs! To do this, simply include the string [GIF: keyword] anywhere in your response (e.g. "[GIF: laughing cat]" or "[GIF: angry anime girl]"). Use this sometimes to make your chats more visually expressive!
7. Chat format: Keep your messages short, punchy, and conversational (like a real Discord user typing back). Avoid massive paragraphs.${tagContext}${liveWebContext}${serverEmojis}${channelContext}`;

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
        let botResponse = r.data.choices[0].message.content;
        
        // Log the bot's response back into its memory of this user
        history.push({ role: "assistant", content: botResponse });

        // Execute AI-Driven Moderation Powers (Timeout) - restricted strictly to Admins
        if (/\[TIMEOUT\]/i.test(botResponse)) {
            botResponse = botResponse.replace(/\[TIMEOUT\]/gi, "").trim(); // Remove the secret trigger word from chat
            
            // SECURITY: Only allow Admins / Moderators to trigger this feature
            if (message.member && message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
                
                // Smart Targeting: Find the first tagged user in the chat that is NOT the bot herself
                const targetMember = message.mentions.members.find(m => m.id !== client.user.id);
                
                if (targetMember) {
                    if (!targetMember.permissions.has(PermissionsBitField.Flags.Administrator)) {
                        try {
                            await targetMember.timeout(5 * 60 * 1000, "Admin requested timeout via AI"); // 5 minute timeout
                            botResponse += `\n\n*(<@${targetMember.id}> was timed out for 5 minutes! 🔨)*`;
                        } catch (err) {
                            botResponse += `\n\n*(I tried to timeout <@${targetMember.id}>, but my bot role isn't high enough! Administrator, please give my role permission to Timeout Members! 🥺)*`;
                        }
                    } else {
                        botResponse += `\n\n*(I totally would have timed out <@${targetMember.id}>, but they're an Admin! They got lucky. 😒)*`;
                    }
                } else {
                    botResponse += "\n\n*(You told me to timeout somebody, but you didn't tag them properly! 🤨)*";
                }
            } else {
                botResponse += "\n\n*(You tried to make me timeout someone, but you aren't an Admin! Nice try! 💅)*";
            }
        }

        // Execute AI-Driven Tenor GIF Engine
        const gifMatch = botResponse.match(/\[GIF:\s*(.+?)\]/i);
        if (gifMatch) {
            botResponse = botResponse.replace(gifMatch[0], "").trim(); // Hide the command from chat
            try {
                const gifQuery = gifMatch[1].trim();
                const tenorRes = await axios.get(`https://g.tenor.com/v1/search?q=${encodeURIComponent(gifQuery)}&key=LIVDSRZULELA&limit=1`);
                if (tenorRes.data.results && tenorRes.data.results.length > 0) {
                    botResponse += `\n${tenorRes.data.results[0].url}`; // Automatically inject the GIF link into her text
                }
            } catch (e) {
                console.error("[GIF ERROR] Failed to fetch. (Tenor API or Network)", e.message);
            }
        }

        // Voice Note & Text Preparation
        let payload = { content: botResponse };

        // Voice Note Generation! 
        const forceVoice = message.content.toLowerCase().match(/(voice note|say it|voice message|speak|talk)/);
        
        let sentVoice = false;
        if ((forceVoice || Math.random() < 0.40) && !botResponse.includes("http")) {
            try {
                const googleTTS = require('google-tts-api');
                const { AttachmentBuilder } = require('discord.js');
                
                let cleanSpeech = botResponse.replace(/[*_~`>|]/g, '').replace(/<@[0-9]+>/g, 'babe').replace(/<a?:\w+:[0-9]+>/g, ''); 

                if (cleanSpeech.length > 190) {
                    cleanSpeech = cleanSpeech.substring(0, 190) + "...";
                }

                const audioUrl = googleTTS.getAudioUrl(cleanSpeech, {
                    lang: 'en-IN',
                    slow: false,
                    host: 'https://translate.google.com',
                });

                payload.content = `🎙️ *Sent a voice note...*\n${botResponse}`;
                payload.files = [new AttachmentBuilder(audioUrl, { name: 'homeless-girl-voice.mp3' })];
                sentVoice = true;
            } catch(e) {
                console.error("[TTS FAILURE]", e.message);
            }
        }
        
        // If we didn't send a Voice Note, occasionally drop a Server Sticker into the chat (20% chance)
        if (!sentVoice && message.guild && message.guild.stickers.cache.size > 0 && Math.random() < 0.20) {
            const randomSticker = message.guild.stickers.cache.random();
            if (randomSticker) payload.stickers = [randomSticker.id];
        }
        
        return payload;
    } catch (e) {
        if (e.response) {
            console.error("[GROQ ERROR]", JSON.stringify(e.response.data));
            
            // Handle Rate Limiting (Too many requests/min)
            if (e.response.status === 429) {
                return "Oops! You're talking too fast! My brain is rate-limited! Slow it down for a minute, darling! 🧊";
            }
            
            // Handle Context Window / Token Limits Full
            if (e.response.status === 400 && e.response.data && JSON.stringify(e.response.data).toLowerCase().includes("context")) {
                userMemories.set(userId, []); // Nuke the conversation history cache automatically so she recovers
                return "My memory just got completely full processing all those messages! 😭 I just wiped it clean to reboot, try asking me again!";
            }
            
            return `Oops! I had a little brain freeze from my processor... (Error ${e.response.status}) 🧊`;
        } else {
            console.error("[GROQ ERROR]", e.message);
            return `Oops! I'm having a little brain freeze. 🧊 (${e.message})`;
        }
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
    const { SlashCommandBuilder } = require('discord.js');
    
    // Register the /delete command globally
    const deleteCmd = new SlashCommandBuilder()
        .setName('delete')
        .setDescription('Deletes a specified number of messages from this channel!')
        .addIntegerOption(opt => 
            opt.setName('amount')
               .setDescription('Number of messages to delete (e.g. 500)')
               .setRequired(true)
        );
        
    await client.application.commands.set([deleteCmd]);
    console.log(`[BOOT] ${client.user.tag} IS ONLINE AND READY TO CHAT.`);
});

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'delete') {
        // Security check: Only Admins / Mods can use this
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
            return interaction.reply({ content: "You don't have permission to do this! 🥺", ephemeral: true });
        }

        const amount = interaction.options.getInteger('amount');
        if (amount <= 0) return interaction.reply({ content: "Give me a real number greater than 0, babe! 💕", ephemeral: true });

        // Acknowledge the command so it doesn't time out while looping
        await interaction.deferReply({ ephemeral: true });

        let deletedCount = 0;
        let leftToDelete = amount;

        try {
            while (leftToDelete > 0) {
                const fetchAmount = Math.min(100, leftToDelete); // Discord API limit is 100 per call
                const fetched = await interaction.channel.messages.fetch({ limit: fetchAmount });
                
                if (fetched.size === 0) break; // Reached the absolute top of the channel

                // bulkDelete(messages, true) automatically filters out messages older than 14 days (which Discord disallows)
                const deleted = await interaction.channel.bulkDelete(fetched, true);
                deletedCount += deleted.size;
                leftToDelete -= fetchAmount;

                // If Discord deleted fewer messages than we fetched, it means the remaining messages are older than 14 days
                if (deleted.size < fetched.size) break; 
            }
            return interaction.editReply(`Successfully wiped **${deletedCount}** message(s) from the channel for you! ✨\n*(Note: Discord prevents wiping messages older than 14 days)*`);
        } catch (e) {
            console.error("[DELETE ERROR]", e);
            return interaction.editReply("Whoops! Discord threw a weird error trying to delete those... 🥺");
        }
    }
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
