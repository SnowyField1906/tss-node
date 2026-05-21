import { execSync, spawn } from 'child_process'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as http from 'http'
import * as path from 'path'

import axios from 'axios'
import * as mongoose from 'mongoose'

const args = process.argv.slice(2)
const N = parseInt(args[0], 10) || 3
const SZ = parseInt(args[1], 10) || 20

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const generateKeyPair = () => {
    const ecdh = crypto.createECDH('secp256k1')
    ecdh.generateKeys()
    return {
        privateKey: ecdh.getPrivateKey('hex'),
        publicKey: ecdh.getPublicKey('hex', 'uncompressed'),
    }
}

let globalBasePort = 35000
let globalOrchPort = 36000
let globalProxyPort = 37000

const forceKillPort = (port: number) => {
    try {
        execSync(`lsof -t -i:${port} | xargs kill -9 2>/dev/null`, { stdio: 'ignore' })
    } catch (e) {}
}

const computeDurations = (orderedKeys: string[], tracking: Record<string, { start: number; end: number }[]>) => {
    const result: number[] = []
    for (let i = 0; i < orderedKeys.length; i++) {
        const key = orderedKeys[i]
        const spans = tracking[key]
        if (!spans || spans.length === 0) {
            result.push(0)
            continue
        }

        const S_i = Math.min(...spans.map((s) => s.start))
        const E_i = Math.max(...spans.map((s) => s.end))

        result.push(E_i - S_i)
    }
    return result
}

const runDkgBenchmark = async () => {
    console.log(`Starting DKG Benchmark for Node-Orchestrator N=${N}, SZ=${SZ}`)
    const THRESHOLD = Math.floor(N / 2) + 1
    const reportData = { dkg: [] as number[][] }

    let allProcesses: ReturnType<typeof spawn>[] = []

    const killAll = () => {
        for (const p of allProcesses) {
            try {
                p.kill('SIGKILL')
            } catch (e) {}
        }
        allProcesses = []
    }

    process.on('SIGINT', () => {
        console.log(`Caught SIGINT. Force killing background processes...`)
        killAll()
        process.exit(1)
    })

    process.on('uncaughtException', (err) => {
        console.error(`Uncaught Exception:`, err)
        killAll()
        process.exit(1)
    })

    process.on('exit', () => {
        killAll()
    })

    const BASE_PORT = globalBasePort
    const ORCH_PORT = globalOrchPort
    const PROXY_PORT = globalProxyPort

    globalBasePort += 100
    globalOrchPort += 1
    globalProxyPort += 1

    forceKillPort(PROXY_PORT)
    forceKillPort(ORCH_PORT)
    for (let i = 1; i <= N; i++) {
        forceKillPort(BASE_PORT + i)
    }

    const PROXY_URL = `http://127.0.0.1:${PROXY_PORT}`
    const ORCH_URL = `${PROXY_URL}/orch`
    const ORCH_DB = `mongodb://127.0.0.1:27017/benchmark-orch-${N}`

    let currentTracking: Record<string, { start: number; end: number }[]> = {}

    const proxyAgent = new http.Agent({ keepAlive: true, maxSockets: 1000 })
    const proxyServer = http.createServer((req, res) => {
        const reqStart = Date.now()
        let targetPath = req.url || '/'
        let isNode = false

        if (targetPath.startsWith('/orch')) {
            targetPath = targetPath.replace('/orch', '')
            if (!targetPath) targetPath = '/'
        } else if (targetPath.startsWith('/node/')) {
            isNode = true
            const parts = targetPath.split('/')
            req.headers['x-target-port'] = (BASE_PORT + parseInt(parts[2], 10)).toString()
            targetPath = '/' + parts.slice(3).join('/')
        }

        let phaseKey = ''
        if (targetPath.includes('/dkg/broadcast')) phaseKey = 'dkg[1]'
        else if (targetPath.includes('/dkg/receive')) phaseKey = 'dkg[2]'
        else if (targetPath.includes('/dkg/compute-public-key')) phaseKey = 'dkg[3]'

        const portToUse = isNode ? parseInt(req.headers['x-target-port'] as string, 10) : ORCH_PORT

        const options = {
            hostname: '127.0.0.1',
            port: portToUse,
            path: targetPath,
            method: req.method,
            headers: req.headers,
            agent: proxyAgent,
        }

        delete options.headers.host

        const proxyReq = http.request(options, (proxyRes) => {
            res.writeHead(proxyRes.statusCode || 200, proxyRes.headers)
            proxyRes.pipe(res)

            proxyRes.on('end', () => {
                const reqEnd = Date.now()
                if (phaseKey) {
                    if (!currentTracking[phaseKey]) {
                        currentTracking[phaseKey] = []
                    }
                    currentTracking[phaseKey].push({ start: reqStart, end: reqEnd })
                }
            })
        })

        req.pipe(proxyReq)
        proxyReq.on('error', (e) => {
            console.error('Proxy Error on', targetPath, ':', e.message)
            res.statusCode = 500
            res.end()
        })
    })

    await new Promise<void>((resolve) => proxyServer.listen(PROXY_PORT, () => resolve()))

    const nodesData = Array.from({ length: N }).map((_, i) => {
        const id = i + 1
        const port = BASE_PORT + id
        const keypair = generateKeyPair()
        return {
            id,
            port,
            url: `${PROXY_URL}/node/${id}`,
            dbUri: `mongodb://127.0.0.1:27017/benchmark-node-${id}`,
            ...keypair,
        }
    })

    let conn = await mongoose.createConnection(ORCH_DB).asPromise()
    await conn.db.dropDatabase()
    await conn.close()

    for (const node of nodesData) {
        conn = await mongoose.createConnection(node.dbUri).asPromise()
        await conn.db.dropDatabase()
        await conn.close()
    }

    const nodeSharedEnv: any = {
        NODE_ENV: 'local',
        SIZE: N.toString(),
        THRESHOLD: THRESHOLD.toString(),
        HOST: '127.0.0.1',
        ORCHESTRATOR_URL: ORCH_URL,
    }

    const orchEnv: any = {
        ...process.env,
        NODE_ENV: 'local',
        SIZE: N.toString(),
        THRESHOLD: THRESHOLD.toString(),
        HOST: '127.0.0.1',
        PORT: ORCH_PORT.toString(),
        MONGO_URI: ORCH_DB,
    }

    for (const node of nodesData) {
        nodeSharedEnv[`NODE_${node.id}_PUBLIC_KEY`] = node.publicKey
        orchEnv[`NODE_${node.id}_URL`] = node.url
    }

    console.log(`Spawning orchestrator...`)
    const orchProcess = spawn(process.execPath, ['dist/main.js'], {
        cwd: path.resolve(__dirname, '../../tss-orchestrator'),
        env: orchEnv,
        stdio: 'inherit',
    })
    allProcesses.push(orchProcess)

    console.log(`Spawning ${N} node processes...`)
    for (const node of nodesData) {
        const env = {
            ...process.env,
            ...nodeSharedEnv,
            NODE_ID: node.id.toString(),
            PORT: node.port.toString(),
            PRIVATE_KEY: node.privateKey,
            MONGO_URI: node.dbUri,
        }

        const child = spawn('node', ['dist/main.js'], {
            env,
            stdio: 'inherit',
        })
        allProcesses.push(child)
    }

    console.log('Waiting for processes to start...')
    let nodesUp = 0
    const checkStart = Date.now()
    while (nodesUp < N + 1 && Date.now() - checkStart < 30000) {
        nodesUp = 0
        try {
            const res = await axios.get(`${ORCH_URL}/`)
            if (res.status === 200 && res.data === 'pong!') nodesUp++
        } catch (e: any) {}
        for (const node of nodesData) {
            try {
                const res = await axios.get(`${node.url}/`)
                if (res.status === 200 && res.data === 'pong!') nodesUp++
            } catch (e: any) {}
        }
        if (nodesUp < N + 1) await delay(1000)
    }
    console.log(`All processes up in ${Date.now() - checkStart}ms`)

    for (let r = 0; r < SZ; r++) {
        console.log(`\n--- Iteration ${r + 1}/${SZ} ---`)
        try {
            console.log(`Processes started. Initializing DKG from Orchestrator...`)
            currentTracking = {} // Reset tracking to not capture startup noise

            const res = await axios.post(`${ORCH_URL}/dkg/initialize`, {})
            if (!res.data.success) {
                throw new Error('DKG Failed')
            }

            console.log(`Waiting for all ${N} nodes to complete DKG...`)
            let dkgDone = false
            while (!dkgDone) {
                let allDone = true
                for (const node of nodesData) {
                    conn = await mongoose.createConnection(node.dbUri).asPromise()
                    const keyDoc = await conn.collection('keys').findOne({})
                    await conn.close()
                    if (!keyDoc || !keyDoc.Y) {
                        allDone = false
                        break
                    }
                }
                if (allDone) {
                    dkgDone = true
                } else {
                    await delay(1000)
                }
            }

            const orderedKeys = ['dkg[1]', 'dkg[2]', 'dkg[3]']
            const durations = computeDurations(orderedKeys, currentTracking)
            reportData.dkg.push(durations)

            console.log(`DKG iteration ${r + 1} completed: [${durations.join(', ')}]`)
        } catch (err: any) {
            console.error(`Error during benchmark N=${N}:`, err.message)
        }
    }

    killAll()
    proxyServer.close()
    await delay(2000)

    const reportPath = path.join(__dirname, 'dkg-report.json')
    let finalReport: any = {}
    if (fs.existsSync(reportPath)) {
        finalReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
    }
    finalReport[`N=${N}`] = reportData.dkg
    fs.writeFileSync(reportPath, JSON.stringify(finalReport, null, 2))

    console.log('All benchmarks completed. Report saved to dkg-report.json.')
    process.exit(0)
}

runDkgBenchmark()
