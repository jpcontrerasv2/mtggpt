import express from "express";
import cors from "cors";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.send("El servidor está funcionando correctamente 🚀");
});

app.get("/card/:name", async (req, res) => {
    try {
        const name = req.params.name;
        const response = await axios.get(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`);

        const { name: cardName, type_line, oracle_text, image_uris, prices, scryfall_uri } = response.data;

        return res.json({
            name: cardName,
            type_line,
            oracle_text,
            image: image_uris?.normal,
            prices,
            scryfall_uri
        });
    } catch (error) {
        return res.status(404).json({ error: "Carta no encontrada en Scryfall." });
    }
});

app.get("/moxfield/:id", async (req, res) => {
    try {
        const deckId = req.params.id;
        const response = await axios.get(`https://api.moxfield.com/v2/decks/all/${deckId}`);

        const deck = response.data;
        const commander = Object.values(deck.commanders)[0]?.card?.name || "Sin comandante";
        const cards = Object.values(deck.mainboard).map(c => `${c.quantity} ${c.card.name}`);

        return res.json({
            name: deck.name,
            commander,
            cards,
            publicUrl: `https://www.moxfield.com/decks/${deckId}`
        });
    } catch (error) {
        console.error(error);
        return res.status(404).json({ error: "No se pudo obtener el mazo desde Moxfield." });
    }
});




app.post("/ask", async (req, res) => {
    try {
        if (!process.env.OPENAI_API_KEY) {
            return res.status(500).json({ error: "La API Key de OpenAI no está definida en el servidor." });
        }

        const { question } = req.body;
        if (!question || question.trim() === "") {
            return res.status(400).json({ error: "La pregunta no puede estar vacía." });
        }

        if (/precio de|cuánto cuesta/i.test(question)) {
            const cardName = question.replace(/(precio de|cuánto cuesta)/gi, "").trim();

            try {
                const response = await axios.get(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cardName)}`);

                if (response.data && response.data.prices) {
                    const { name, prices, scryfall_uri } = response.data;

                    return res.json({
                        answer: `💰 **Precios de ${name}:**  \n- **Precio regular:** ${prices.usd ? `$${prices.usd}` : "No disponible"}  \n- **Precio foil:** ${prices.usd_foil ? `$${prices.usd_foil}` : "No disponible"}  \n- **Precio en CardMarket:** ${prices.eur ? `€${prices.eur}` : "No disponible"}  \n- **Precio foil en CardMarket:** ${prices.eur_foil ? `€${prices.eur_foil}` : "No disponible"}  \n🔗 [Ver en Scryfall](${scryfall_uri})`
                    });
                } else {
                    return res.json({ answer: "No encontré información de precios para esa carta en Scryfall." });
                }
            } catch (error) {
                return res.json({ answer: "No encontré la carta en Scryfall o hubo un error en la búsqueda." });
            }
        }

        const isDeckList = question.split("\n").every(line => /^\d+\s.+/.test(line.trim()));

        if (isDeckList) {
            return res.json({ answer: await optimizeDeck(question) });
        }

        const threadResponse = await axios.post(
            "https://api.openai.com/v1/threads",
            {},
            { headers: authHeaders() }
        );

        const threadId = threadResponse.data.id;

        await axios.post(
            `https://api.openai.com/v1/threads/${threadId}/messages`,
            { role: "user", content: question },
            { headers: authHeaders() }
        );

        const runResponse = await axios.post(
            `https://api.openai.com/v1/threads/${threadId}/runs`,
            { assistant_id: "asst_fFMc7RSnZ9GboO9x0a2iEsRz" },
            { headers: authHeaders() }
        );

        const runId = runResponse.data.id;
        let status = "in_progress";
        let assistantResponse = "El asistente no generó una respuesta.";

        while (status === "in_progress" || status === "queued") {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const runStatus = await axios.get(
                `https://api.openai.com/v1/threads/${threadId}/runs/${runId}`,
                { headers: authHeaders() }
            );
            status = runStatus.data.status;
        }

        if (status === "completed") {
            const messagesResponse = await axios.get(
                `https://api.openai.com/v1/threads/${threadId}/messages`,
                { headers: authHeaders() }
            );
            const assistantMessages = messagesResponse.data.data.filter(msg => msg.role === "assistant");

            if (assistantMessages.length > 0 && assistantMessages[0].content?.[0]?.text) {
                assistantResponse = assistantMessages[0].content[0].text.value;
            }
        }

        res.json({ answer: assistantResponse });

    } catch (error) {
        res.status(500).json({ error: "Hubo un error al consultar el asistente." });
    }
});

const optimizeDeck = async (deckList) => {
    const cards = deckList.split("\n").map(line => line.trim()).filter(line => line);
    const cardCounts = {};
    const notFound = [];

    for (const line of cards) {
        const match = line.match(/^(\d+)\s(.+)/);
        if (match) {
            const quantity = parseInt(match[1], 10);
            const cardName = match[2].split("(")[0].trim();
            cardCounts[cardName] = (cardCounts[cardName] || 0) + quantity;

            try {
                await axios.get(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cardName)}`);
            } catch {
                notFound.push(cardName);
            }
        }
    }

    const duplicates = Object.entries(cardCounts).filter(([_, count]) => count > 1);

    let response = `🔍 **Análisis de mazo:**\n\n`;
    response += `✅ Se detectaron **${Object.keys(cardCounts).length} cartas únicas** en el mazo.\n`;

    if (duplicates.length > 0) {
        response += `⚠️ **Cartas duplicadas:**\n`;
        for (const [name, count] of duplicates) {
            response += `- ${name} (${count} copias)\n`;
        }
        response += `\nSi este es un mazo de **Commander**, verifica que no haya más de una copia por carta (excepto tierras básicas).`;
    } else {
        response += `✅ No se encontraron cartas duplicadas.\n`;
    }

    if (notFound.length > 0) {
        response += `\n❓ **Cartas no encontradas en Scryfall:**\n`;
        for (const name of notFound) {
            response += `- ${name}\n`;
        }
    }

    return response;
};

const authHeaders = () => ({
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    "Content-Type": "application/json",
    "OpenAI-Beta": "assistants=v2"
});

app.listen(PORT, () => {
    console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});
