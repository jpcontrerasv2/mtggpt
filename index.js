import express from "express";
import cors from "cors";
import axios from "axios";
import dotenv from "dotenv";
import './i18n/config';


dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.send("El servidor está funcionando correctamente 🚀");
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

        // 🟢 Detectar si la pregunta es sobre precios de cartas
        if (/precio de|cuánto cuesta/i.test(question)) {
            const cardName = question.replace(/(precio de|cuánto cuesta)/gi, "").trim();

            try {
                const response = await axios.get(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cardName)}`);

                if (response.data && response.data.prices) {
                    const { name, prices, scryfall_uri } = response.data;

                    return res.json({
                        answer: `💰 **Precios de ${name}:**  
                - **Precio regular:** ${prices.usd ? `$${prices.usd}` : "No disponible"}  
                - **Precio foil:** ${prices.usd_foil ? `$${prices.usd_foil}` : "No disponible"}  
                - **Precio en CardMarket:** ${prices.eur ? `€${prices.eur}` : "No disponible"}  
                - **Precio foil en CardMarket:** ${prices.eur_foil ? `€${prices.eur_foil}` : "No disponible"}  
                🔗 [Ver en Scryfall](${scryfall_uri})`
                    });
                } else {
                    return res.json({ answer: "No encontré información de precios para esa carta en Scryfall." });
                }
            } catch (error) {
                console.error("Error al consultar Scryfall:", error);
                return res.json({ answer: "No encontré la carta en Scryfall o hubo un error en la búsqueda." });
            }
        }

        // 🟢 Detectar si es una lista de cartas (cada línea comienza con un número)
        const isDeckList = question.split("\n").every(line => /^\d+\s.+/.test(line.trim()));

        if (isDeckList) {
            console.log("📌 Se detectó una lista de cartas. Optimizando...");
            return res.json({ answer: await optimizeDeck(question) });
        }

        // 🔍 Si no es una consulta de precios ni una lista de cartas, seguir con OpenAI
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
        console.error("Error con OpenAI:", error.response?.data || error.message);
        res.status(500).json({ error: "Hubo un error al consultar el asistente." });
    }
});

/**
 * 🔹 Función para optimizar un mazo de Magic: The Gathering
 */
const optimizeDeck = async (deckList) => {
    const cards = deckList.split("\n").map(line => line.trim()).filter(line => line);

    // Contar cuántas veces se repite cada carta
    const cardCounts = {};
    cards.forEach(line => {
        const match = line.match(/^(\d+)\s(.+)/); // Extrae el número y el nombre
        if (match) {
            const quantity = parseInt(match[1], 10);
            const cardName = match[2].split("(")[0].trim();
            cardCounts[cardName] = (cardCounts[cardName] || 0) + quantity;
        }
    });

    // Detectar cartas con más de 1 copia (en formatos singleton como Commander)
    const duplicates = Object.entries(cardCounts).filter(([name, count]) => count > 1);

    let response = `🔍 **Análisis de mazo:**\n\n`;
    response += `✅ Se detectaron **${Object.keys(cardCounts).length} cartas únicas** en el mazo.\n`;

    if (duplicates.length > 0) {
        response += `⚠️ **Cartas duplicadas:**\n`;
        duplicates.forEach(([name, count]) => {
            response += `- ${name} (${count} copias)\n`;
        });
        response += `\nSi este es un mazo de **Commander**, verifica que no haya más de una copia por carta (excepto tierras básicas).`;
    } else {
        response += `✅ No se encontraron cartas duplicadas.`;
    }

    return response;
};

/**
 * 🔹 Función para definir headers de autenticación de OpenAI
 */
const authHeaders = () => ({
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    "Content-Type": "application/json",
    "OpenAI-Beta": "assistants=v2"
});

// 🚀 Iniciar el servidor
app.listen(PORT, () => {
    console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});
app.get("/card/:name", async (req, res) => {
    const cardName = req.params.name;

    try {
        const response = await axios.get(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(cardName)}`);
        const data = response.data;

        res.json({
            name: data.name,
            type_line: data.type_line,
            oracle_text: data.oracle_text || data.card_faces?.[0]?.oracle_text || "Sin texto disponible",
            image: data.image_uris?.normal || data.card_faces?.[0]?.image_uris?.normal || null,
            prices: data.prices,
            scryfall_uri: data.scryfall_uri
        });
    } catch (error) {
        console.error("Error buscando carta en Scryfall:", error.message);
        res.status(404).json({ error: "No se encontró la carta en Scryfall." });
    }
});
