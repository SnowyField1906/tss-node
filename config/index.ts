import * as dotenv from 'dotenv'

const isLocal = process.env.NODE_ENV === 'local'
dotenv.config({ path: isLocal ? `node-${process.env.NODE_ID}.env.local` : '.env' })

export default () => ({
    id: Number(process.env.NODE_ID),
    host: process.env.HOST,
    port: process.env.PORT,
    mongoUri: process.env.MONGO_URI,
    privateKey: process.env.PRIVATE_KEY,
    orchestratorUrl: process.env.ORCHESTRATOR_URL,
    networkPublicKeys: Array.from({ length: Number(process.env.SIZE) }).reduce(
        (acc, _, i) => {
            acc[i + 1] = process.env[`NODE_${i + 1}_PUBLIC_KEY`]
            return acc
        },
        {} as Record<number, string>
    ),
})
