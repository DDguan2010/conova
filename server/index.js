import 'dotenv/config'
import { createApp } from './app.js'

const port = Number(process.env.PORT || 3210)
const host = process.env.HOST || '127.0.0.1'
const { app } = await createApp({ dataDir: process.env.CONOVA_DATA_DIR, extraOrigins: (process.env.CONOVA_ORIGINS || '').split(',').filter(Boolean) })
app.listen(port, host, () => console.log(`Conova → http://${host}:${port}`))
