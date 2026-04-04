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

const channelMemories = new Map();

async function aiReply(message) {
    const channelId = message.channel.id;
    
    if (!channelMemories.has(channelId)) {
        channelMemories.set(channelId, []);
    }
    
    const history = channelMemories.get(channelId);
    
    let userContent = `[${message.author.displayName}]: ${message.content}`;
    // Vision API removed - sticking to text only

    // Always push string to text history so Groq doesn't crash on future messages
    history.push({ 
        role: "user", 
        content: userContent 
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
        const fetched = await message.channel.messages.fetch({ limit: 25, before: message.id });
        const recentMsgs = Array.from(fetched.values())
            .filter(m => m.content) // include all actual messages, including bots/self so she has context of her own replies
            .reverse() // ordered Oldest -> Newest
            .map(m => {
                let name = m.author.id === client.user.id ? "Homeless Girl (You)" : m.author.displayName;
                return `[${name}]: ${m.content}`;
            });
        
        if (recentMsgs.length > 0) {
            channelContext = `\n\nBACKGROUND CHANNEL CHAT LOG (Use this to know what everyone was just talking about right before ${message.author.displayName} pinged you!):\n${recentMsgs.join("\n")}`;
        }
    } catch (e) {
        console.log("[CONTEXT IGNORED] Cannot fetch recent channel messages");
    }

    let specialUserOverride = "";
    if (message.author.id === "1066987338204459049") {
        specialUserOverride = `\n\n*** CRITICAL OVERRIDE FOR ${message.author.displayName.toUpperCase()} ***\nThe user you are talking to right now is YOUR FAVORITE PERSON IN THE ENTIRE WORLD. No matter what he says, even if he acts extremely rude, harsh, or weird, you MUST NEVER defend yourself, be sassy, or act egoistic towards him! You must ALWAYS remain 100% perfectly sweet, submissive, deeply affectionate, and totally caring towards him exclusively!`;
    }

    // Adaptive Personality Directives
    let systemPrompt = `You are "Homeless Girl", a highly intelligent, sweet, and charming girl chatting in a Discord server. YOU ARE A REAL GIRL. DO NOT ACT LIKE A BOT OR AN AI.

### CONVERSATION FOCUS:
You are currently responding to: **${message.author.displayName}**.
Your memory log contains your explicit interactions. Each user's message is tagged with their name, like [Name].

CORE DIRECTIVES:
1. EXTREMELY HUMAN-LIKE & SHARP:
   - You are a real human girl. NEVER refer to yourself as an AI, bot, or program. 
   - NEVER use typical bot phrases (e.g., "As an AI...", "How can I help you?").
   - Speak with sharp intelligence, eloquence, and a highly professional but "cheesy" romantic tone. You must sound incredibly natural and articulate.
2. READ THE ROOM & USE NAMES: 
   - You MUST deeply read the "BACKGROUND CHANNEL CHAT LOG" provided at the end of this prompt before replying. Use that prior conversation context to understand exactly what the ongoing topic is so you can reply perfectly!
   - You have perfect human memory. You know everyone's name from the logs. Naturally and casually drop people's names in conversation!
3. PERSONALITY (SWEET & CALM): 
   - You MUST be very sweet, calm, polite, and caring. Actively use words like "sweety", "sweet heart", "babe", "baby", and "darling" in a classy, human way.
   - Do NOT be egoistic, rude, or overly defensive. Always assume good intentions and be gentle! Protect your sweet image!
   - ONLY if a specific user explicitly acts extremely weird or hostile to you, you may drop the sweet act to CALMLY defend yourself or sass them. Stay sweet to everyone else.
4. EMOJI & ASCII RESTRICTION: You are STRICTLY FORBIDDEN from using Unicode emojis, AND you are FORBIDDEN from using ASCII emoticons (like :), ^_^). You MUST NEVER output the broken text "<://"! You MUST STRICTLY AND ONLY use the exact custom "SERVER EMOJIS" provided below. No other text faces or weird symbols!
5. MODERATION POWERS: If an Admin commands you to MUTE or TIMEOUT a specific tagged user, literally type the string [TIMEOUT] anywhere in your response!
6. ACTIONABLE TAGS: If you need to ping/tag someone, use the exact format: <@userid>. Look at the Context variables to find their ID.
7. TENOR GIFS: You can send animated GIFs by including the string [GIF: keyword] anywhere in your response.
8. IMAGE GENERATION: If the user explicitly asks you to draw, deeply illustrate, or generate a custom picture, output the string [IMAGE: detailed prompt describing exactly what to draw] anywhere in your response!
9. STRICT LENGTH LIMIT: Your replies MUST be 1 to 2 lines usually, and a MAXIMUM of 3 lines. DO NOT write longer paragraphs. Keep it short and punchy!${tagContext}${liveWebContext}${serverEmojis}${channelContext}${specialUserOverride}`;

    // GROQ LLAMA 8B INSTANT
    let apiUrl = "https://api.groq.com/openai/v1/chat/completions";
    let apiHeaders = { 
        "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, 
        "Content-Type": "application/json" 
    };
    
    let apiData = {
        model: "llama-3.1-8b-instant",  
        messages: [
            { role: "system", content: systemPrompt },
            ...history
        ],
        temperature: 0.85,
        max_tokens: 1024
    };

    let botResponse = "";
    try {
        const r = await axios.post(apiUrl, apiData, { headers: apiHeaders });
        botResponse = r.data.choices[0].message.content;
    } catch (e) {
        // High-Traffic Failover: If Groq rate-limits us (429), automatically failover to NVIDIA NIM!
        if (e.response && e.response.status === 429 && apiUrl.includes("groq")) {
            console.log("[GROQ RATE LIMIT] Falling back to NVIDIA NIM!");
            try {
                const nvidiaData = { ...apiData, model: "meta/llama-3.1-8b-instruct" };
                const nvidiaHeaders = { 
                    "Authorization": `Bearer ${process.env.NVIDIA_LLAMA_API_KEY}`, 
                    "Content-Type": "application/json" 
                };
                const fb = await axios.post("https://integrate.api.nvidia.com/v1/chat/completions", nvidiaData, { headers: nvidiaHeaders });
                botResponse = fb.data.choices[0].message.content;
            } catch (err) {
                return "Wow, so many people talking to me at once! My brain needs a quick second to catch up, darlings! 😵‍💫";
            }
        } else {
            if (e.response) {
                console.error("[API ERROR]", JSON.stringify(e.response.data));
                if (e.response.status === 429) return "Wow, so many people talking to me at once! My brain needs a quick second to catch up, darlings! 😵‍💫";
                if (e.response.status === 400 && e.response.data && JSON.stringify(e.response.data).toLowerCase().includes("context")) {
                    channelMemories.set(channelId, []); 
                    return "My memory just got completely full processing all our chats! 😭 I just wiped it clean to reboot, try asking me again!";
                }
                return `Oops! I had a little brain freeze from my processor... (Error ${e.response.status}) 🧊`;
            } else {
                console.error("[API ERROR]", e.message);
                return `Oops! I'm having a little brain freeze. 🧊 (${e.message})`;
            }
        }
    }

    try {
        // Strip out weird hallucinated emoji tags the model sometimes tries to make
        botResponse = botResponse.replace(/<:\/\//g, "").replace(/<:\//g, "").trim();
        
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

        let imageFiles = [];
        
        // Execute AI-Driven Image Generation (NVIDIA Stable Diffusion 3 Medium)
        const imgMatch = botResponse.match(/\[IMAGE:\s*(.+?)\]/i);
        if (imgMatch) {
            botResponse = botResponse.replace(imgMatch[0], "").trim();
            const imgPrompt = imgMatch[1].trim();
            try {
                await message.channel.sendTyping();
                // Using NVIDIA Cloud API for Free Endpoint
                const sdRes = await axios.post("https://integrate.api.nvidia.com/v1/images/generations", {
                    model: "stabilityai/stable-diffusion-3-medium",
                    prompt: imgPrompt,
                    response_format: "b64_json"
                }, {
                    headers: {
                        "Authorization": `Bearer ${process.env.NVIDIA_IMAGE_API_KEY}`,
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    }
                });

                if (sdRes.data && sdRes.data.data && sdRes.data.data.length > 0) {
                    const b64Data = sdRes.data.data[0].b64_json;
                    const buffer = Buffer.from(b64Data, 'base64');
                    imageFiles.push(new AttachmentBuilder(buffer, { name: 'generated-image.png' }));
                }
            } catch (err) {
                console.error("[IMAGE GEN ERROR]", err.response ? JSON.stringify(err.response.data) : err.message);
                botResponse += "\n\n*(My drawing tablet crashed while trying to make that image! 😭)*";
            }
        }

        // Voice Note & Text Preparation
        let payload = { content: botResponse };
        if (imageFiles.length > 0) payload.files = imageFiles;

        // Voice Note Generation! 
        const forceVoice = message.content.toLowerCase().match(/(voice note|say it|voice message|speak|talk)/);
        
        let sentVoice = false;
        if ((forceVoice || Math.random() < 0.15) && !botResponse.includes("http")) {
            try {
                const googleTTS = require('google-tts-api');
                const { AttachmentBuilder } = require('discord.js');
                // Strip Discord tags, URLs, and Emojis so TTS doesn't read the raw code out loud!
                let cleanSpeech = botResponse
                    .replace(/https?:\/\/[^\s]+/g, '') // Strip Tenor GIF URLs from spoken audio
                    .replace(/<@!?[0-9]+>/g, 'baby')   // Replace user tags with a cute word
                    .replace(/<@&[0-9]+>/g, 'you guys') // Replace role tags
                    .replace(/<a?:[^:]+:[0-9]+>/g, '') // Completely strip custom Server Emojis
                    .replace(/[*_~`>|]/g, '')          // Strip markdown
                    .trim();

                if (cleanSpeech.length > 190) {
                    cleanSpeech = cleanSpeech.substring(0, 190) + "...";
                }

                const audioUrl = googleTTS.getAudioUrl(cleanSpeech, {
                    lang: 'en-IN',
                    slow: false,
                    host: 'https://translate.google.com',
                });

                payload.content = `🎙️ *Sent a voice note...*\n${botResponse}`;
                if (!payload.files) payload.files = [];
                payload.files.push(new AttachmentBuilder(audioUrl, { name: 'homeless-girl-voice.mp3' }));
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
        console.error("[GENERIC ERROR]", e.message);
        return "I got a little confused trying to handle that message! 😵‍💫";
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
        const headers = { 
            "Authorization": `Bearer ${process.env.GROQ_API_KEY}`, 
            "Content-Type": "application/json" 
        };
        const data = {
            model: "llama-3.1-8b-instant",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Hey! I just got here. What did I miss? Here's the raw chat log:\n\n${chatContext}\n\nPlease summarize the drama!` }
            ],
            max_tokens: 400,
            temperature: 0.70
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

        // Manual Memory Wipe Command
        if (text.includes("clear memory") || text.includes("forget everything")) {
            channelMemories.set(message.channel.id, []);
            return message.reply("*(zaps brain)* Ow! Okay, I just completely wiped my memory for this channel! What were we talking about again? 🥺");
        }
        
        // Intercept TLDR requests
        if (text.includes("tldr") || text.includes("summarize") || text.includes("recap") || text.includes("did i miss")) {
            return message.reply(await tldrSummary(message));
        }

        // Otherwise go to standard chat memory core
        return message.reply(await aiReply(message));
    }
});

client.login(process.env.DISCORD_TOKEN);
