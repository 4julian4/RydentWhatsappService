const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Determinar la ruta de Chrome/Chromium
const getChromePath = () => {
    const paths = [
        path.join(process.cwd(), 'chromium', 'chrome.exe'),
        path.join(__dirname, 'chromium', 'chrome.exe'),
        '/usr/bin/google-chrome', // Linux
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // MacOS
    ];
    return paths.find(fs.existsSync) || null;
};

const chromePath = getChromePath();
if (!chromePath) {
    console.error('No se encontró una instalación de Chrome/Chromium.');
    process.exit(1);
}

// Función para limpiar el número de teléfono
const cleanPhoneNumber = (phoneNumber) => phoneNumber.replace(/[^\d\+]/g, '');

// Variable para el cliente de WhatsApp
let client;

// Inicializar cliente de WhatsApp
const initializeClient = () => {
    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: false, // Cambiar a false si quieres ver el navegador
            executablePath: chromePath,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--start-maximized',
            ],
        },
    });

    client.on('qr', (qr) => {
        qrcode.generate(qr, { small: true });
        console.log('Escanea el código QR con tu WhatsApp.');
    });

    client.on('ready', () => {
        console.log('Cliente de WhatsApp está listo y conectado.');
    });

    client.on('disconnected', (reason) => {
        console.error(`Cliente desconectado: ${reason}`);
        reconnectClient();
    });

    client.on('auth_failure', (msg) => {
        console.error(`Fallo en la autenticación: ${msg}`);
        reconnectClient();
    });

    client.on('error', (error) => {
        console.error(`Error en el cliente: ${error.message}`);
        if (error.message.includes('Session closed')) {
            console.log('Detectado cierre de sesión. Reiniciando cliente...');
            reconnectClient();
        }
    });

    client.initialize();
};

// Reconectar cliente
const reconnectClient = async () => {
    try {
        console.log('Intentando reiniciar cliente...');
        if (client) {
            await client.destroy();
        }
    } catch (err) {
        console.error(`Error al destruir el cliente: ${err.message}`);
    } finally {
        initializeClient();
    }
};

// Monitor de suspensión del sistema
let lastCheckTime = Date.now();

const monitorSystem = () => {
    setInterval(() => {
        const currentTime = Date.now();
        const timeDifference = currentTime - lastCheckTime;

        if (timeDifference > 60 * 1000) {
            console.log('Sistema reanudado tras suspensión. Verificando cliente...');
            if (!client || !client.info || !client.info.wid) {
                reconnectClient();
            } else {
                console.log('Cliente ya está activo.');
            }
        }

        lastCheckTime = currentTime;
    }, 30 * 1000);
};

// Llamar al inicializador y al monitor del sistema
initializeClient();
monitorSystem();

// Endpoints de la API
app.post('/send-message', async (req, res) => {
    const { phoneNumber, message } = req.body;

    if (!phoneNumber || !message) {
        return res.status(400).send({ status: 'Faltan parámetros: phoneNumber y/o message.' });
    }

    const cleanedPhoneNumber = cleanPhoneNumber(phoneNumber).replace(/^\+/, '');

    try {
        if (!client || !client.info || !client.info.wid) {
            console.log('Cliente no conectado. Intentando reconectar...');
            await reconnectClient();
            return res.status(503).send({ status: 'Cliente no conectado. Intentando reconectar.' });
        }

        const numberId = await client.getNumberId(cleanedPhoneNumber);
        if (numberId) {
            await client.sendMessage(numberId._serialized, message);
            console.log(`Mensaje enviado a ${cleanedPhoneNumber}: ${message}`);
            res.status(200).send({ status: 'Mensaje enviado correctamente.' });
        } else {
            console.log(`Número no encontrado en WhatsApp: ${cleanedPhoneNumber}`);
            res.status(404).send({ status: 'Número no encontrado en WhatsApp.' });
        }
    } catch (error) {
        console.error(`Error al enviar mensaje a ${cleanedPhoneNumber}: ${error.message}`);
        if (error.message.includes('Session closed')) {
            reconnectClient();
        }
        res.status(500).send({ status: 'Error al enviar el mensaje.', error: error.message });
    }
});

app.get('/status', (req, res) => {
    if (client && client.info) {
        res.status(200).send({ status: 'Cliente conectado', info: client.info });
    } else {
        res.status(500).send({ status: 'Cliente no conectado' });
    }
});

app.post('/logout', async (req, res) => {
    try {
        await client.logout();
        console.log('Cliente desconectado correctamente.');
        res.status(200).send({ status: 'Cliente desconectado correctamente.' });
    } catch (error) {
        console.error(`Error al desconectar cliente: ${error.message}`);
        res.status(500).send({ status: 'Error al desconectar el cliente.', error: error.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
