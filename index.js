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
        return res.status(404).json({
            error: "Carta no encontrada en Scryfall."
        });
    }
});

app.get("/moxfield/recommend", async (req, res) => {
    try {
        const { url } = req.query;
        const deckIdMatch = url.match(/decks\/([a-zA-Z0-9]+)/);
        if (!deckIdMatch) {
            return res.status(400).json({ error: "URL de mazo no válida." });
        }
        const deckId = deckIdMatch[1];

        const response = await axios.get(`https://api.moxfield.com/v2/decks/all/${deckId}`);
        const deck = response.data;

        const cardsList = Object.values(deck.mainboard).map(c => `${c.quantity} ${c.card.name}`).join('\n');
        const commanderList = deck.commanders?.map(c => c.card.name).join(', ') || "No commander";
        const deckDescription = `Mazo: ${deck.name}\nFormato: ${deck.format || "Desconocido"}\nComandante(s): ${commanderList}\nCartas del mazo:\n${cardsList}`;

        const prompt = `Analiza el siguiente mazo de Magic: The Gathering y proporciona sugerencias y recomendaciones para mejorar su estrategia, sin importar el formato:\n\n${deckDescription}`;

        const threadResponse = await axios.post("https://api.openai.com/v1/threads", {}, { headers: authHeaders() });
        const threadId = threadResponse.data.id;

        await axios.post(`https://api.openai.com/v1/threads/${threadId}/messages`, {
            role: "user",
            content: prompt
        }, { headers: authHeaders() });

        const runResponse = await axios.post(`https://api.openai.com/v1/threads/${threadId}/runs`, {
            assistant_id: "asst_fFMc7RSnZ9GboO9x0a2iEsRz"
        }, { headers: authHeaders() });

        const runId = runResponse.data.id;
        let status = "in_progress";
        let assistantResponse = "El asistente no generó una respuesta.";

        while (["in_progress", "queued"].includes(status)) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const runStatus = await axios.get(
                `https://api.openai.com/v1/threads/${threadId}/runs/${runId}`,
                { headers: authHeaders() }
            );
            status = runStatus.data.status;
        }

        if (status === "completed") {
            const messagesResponse = await axios.get(`https://api.openai.com/v1/threads/${threadId}/messages`, { headers: authHeaders() });
            const assistantMessages = messagesResponse.data.data.filter(msg => msg.role === "assistant");
            if (assistantMessages.length > 0 && assistantMessages[0].content?.[0]?.text) {
                assistantResponse = assistantMessages[0].content[0].text.value;
            }
        }

        res.json({
            deckName: deck.name,
            recommendations: assistantResponse
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: "No se pudo obtener recomendaciones para el mazo."
        });
    }
});

// Endpoint para buscar cartas en Scryfall
app.get("/scryfall/card", async (req, res) => {
    const { name } = req.query;

    if (!name || name.trim() === "") {
        return res.status(400).json({ error: "Debes proporcionar un nombre de carta." });
    }

    try {
        const response = await axios.get(
            `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`
        );

        const cardData = response.data;

        // Devuelve solo datos clave (personalizable)
        res.json({
            name: cardData.name,
            mana_cost: cardData.mana_cost,
            type_line: cardData.type_line,
            oracle_text: cardData.oracle_text,
            set_name: cardData.set_name,
            rarity: cardData.rarity,
            image_uri: cardData.image_uris?.normal,
            scryfall_uri: cardData.scryfall_uri,
            prices: cardData.prices
        });

    } catch (error) {
        console.error("Error al consultar Scryfall:", error.message);
        res.status(404).json({ error: "No se encontró la carta en Scryfall." });
    }
});

// Proxy endpoint para Moxfield
app.get("/proxy/moxfield/deck", async (req, res) => {
    try {
        const { deckId } = req.query;
        if (!deckId) {
            return res.status(400).json({ error: "Debes proporcionar un ID de mazo." });
        }

        const response = await axios.get(`https://api.moxfield.com/v2/decks/all/${deckId}`);
        res.json(response.data);
    } catch (error) {
        console.error("Error al consultar Moxfield:", error.message);
        res.status(500).json({ error: "No se pudo obtener el mazo de Moxfield." });
    }
});

const authHeaders = () => ({
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    "Content-Type": "application/json",
    "OpenAI-Beta": "assistants=v2"
});

app.listen(PORT, () => {
    console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});