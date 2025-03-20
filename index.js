import express from "express";
import cors from "cors";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3001;

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

        // Crear un thread en Assistants API
        const threadResponse = await axios.post(
            "https://api.openai.com/v1/threads",
            {},
            {
                headers: {
                    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                    "Content-Type": "application/json",
                    "OpenAI-Beta": "assistants=v2"
                }
            }
        );

        const threadId = threadResponse.data.id;

        // Agregar el mensaje del usuario al thread
        await axios.post(
            `https://api.openai.com/v1/threads/${threadId}/messages`,
            { role: "user", content: question },
            {
                headers: {
                    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                    "Content-Type": "application/json",
                    "OpenAI-Beta": "assistants=v2"
                }
            }
        );

        // Ejecutar el asistente en el thread
        const runResponse = await axios.post(
            `https://api.openai.com/v1/threads/${threadId}/runs`,
            { assistant_id: "asst_fFMc7RSnZ9GboO9x0a2iEsRz" },
            {
                headers: {
                    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                    "Content-Type": "application/json",
                    "OpenAI-Beta": "assistants=v2"
                }
            }
        );

        const runId = runResponse.data.id;

        // Esperar respuesta del asistente
        let status = "in_progress";
        let assistantResponse = "El asistente no generó una respuesta.";

        while (status === "in_progress" || status === "queued") {
            await new Promise((resolve) => setTimeout(resolve, 2000)); // Esperar 2 segundos
            const runStatus = await axios.get(
                `https://api.openai.com/v1/threads/${threadId}/runs/${runId}`,
                {
                    headers: {
                        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                        "Content-Type": "application/json",
                        "OpenAI-Beta": "assistants=v2"
                    }
                }
            );

            status = runStatus.data.status;
        }

        if (status === "completed") {
            const messagesResponse = await axios.get(
                `https://api.openai.com/v1/threads/${threadId}/messages`,
                {
                    headers: {
                        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                        "Content-Type": "application/json",
                        "OpenAI-Beta": "assistants=v2"
                    }
                }
            );

            const assistantMessages = messagesResponse.data.data.filter(msg => msg.role === "assistant");

            // Verificar que hay respuestas antes de intentar acceder a 'value'
            if (assistantMessages.length > 0 && assistantMessages[0].content && assistantMessages[0].content[0].text) {
                assistantResponse = assistantMessages[0].content[0].text.value;
            }
        }

        res.json({ answer: assistantResponse });

    } catch (error) {
        console.error("Error con OpenAI:", error.response ? error.response.data : error.message);
        res.status(500).json({ error: "Hubo un error al consultar el asistente." });
    }
});

// Iniciar el servidor
app.listen(PORT, () => {
    console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});
