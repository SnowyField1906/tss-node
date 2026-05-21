import { execSync, spawn } from 'child_process'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as http from 'http'
import * as path from 'path'

import axios from 'axios'
import * as mongoose from 'mongoose'

const SIZES = [3, 7, 11, 15]

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

const allProcesses: any[] = []

const forceKillPort = (port: number) => {
    try {
        execSync(`lsof -t -i:${port} | xargs kill -9 2>/dev/null`, { stdio: 'ignore' })
    } catch (e) {}
}

const killAll = () => {
    for (const p of allProcesses) {
        try {
            p.kill('SIGKILL')
        } catch (e) {}
    }
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

let currentTracking: Record<string, { start: number; end: number }> = {}

const runBenchmark = async (N: number) => {
    console.log(`Starting Benchmark for Node-Orchestrator N=${N}`)

    const THRESHOLD = Math.floor(N / 2) + 1
    const BASE_PORT = globalBasePort
    const ORCH_PORT = globalOrchPort
    const PROXY_PORT = globalProxyPort

    forceKillPort(PROXY_PORT)
    forceKillPort(ORCH_PORT)
    for (let i = 1; i <= N; i++) {
        forceKillPort(BASE_PORT + i)
    }

    globalBasePort += 100
    globalOrchPort += 1
    globalProxyPort += 1

    const PROXY_URL = `http://127.0.0.1:${PROXY_PORT}`
    const ORCH_URL = `${PROXY_URL}/orch`
    const ORCH_DB = `mongodb://127.0.0.1:27017/benchmark-orch-${N}`

    currentTracking = {}

    const reportData: any = {
        dkg: [],
        transactions: [],
    }

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
        else if (targetPath.includes('/fund/latest-state')) phaseKey = 'propose[1]'
        else if (targetPath.includes('/tss/propose')) phaseKey = 'propose[2]'
        else if (targetPath.includes('/tss/start')) phaseKey = 'tss[1]'
        else if (targetPath.includes('/tss/mta')) phaseKey = 'tss[2]'
        else if (targetPath.includes('/tss/delta')) phaseKey = 'tss[3]'
        else if (targetPath.includes('/tss/sign')) phaseKey = 'tss[4]'
        else if (targetPath.includes('/fund/settlement-data')) phaseKey = 'settlement[1]'

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
                if (phaseKey === 'settlement[1]') {
                    currentTracking[phaseKey] = { start: reqStart, end: reqEnd }
                } else if (phaseKey) {
                    if (!currentTracking[phaseKey]) {
                        currentTracking[phaseKey] = { start: reqStart, end: reqEnd }
                    } else {
                        currentTracking[phaseKey].start = Math.min(currentTracking[phaseKey].start, reqStart)
                        currentTracking[phaseKey].end = Math.max(currentTracking[phaseKey].end, reqEnd)
                    }
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

    const processes: ReturnType<typeof spawn>[] = []

    console.log(`Spawning orchestrator...`)
    const orchProcess = spawn(process.execPath, ['dist/main.js'], {
        cwd: path.resolve(__dirname, '../../tss-orchestrator'),
        env: orchEnv,
        stdio: 'inherit',
    })
    processes.push(orchProcess)
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
        processes.push(child)
        allProcesses.push(child)
    }

    console.log('Waiting for processes to start...')
    let nodesUp = 0
    const checkStart = Date.now()
    while (nodesUp < N + 1 && Date.now() - checkStart < 30000) {
        nodesUp = 0
        try {
            await axios.get(`${ORCH_URL}/fund/latest-state?chainId=mainnet_1&userId=test`)
            nodesUp++ // Orchestrator is up
        } catch (e: any) {
            if (e.response && e.response.status !== 500) nodesUp++
        }

        for (const node of nodesData) {
            try {
                await axios.get(`${node.url}/dkg/non-existent-route`)
                nodesUp++
            } catch (e: any) {
                if (e.response && e.response.status !== 500) nodesUp++
            }
        }
        if (nodesUp < N + 1) await delay(1000)
    }
    console.log(`All processes up in ${Date.now() - checkStart}ms`)

    try {
        console.log(`Processes started. Initializing DKG from Orchestrator...`)
        currentTracking = {}

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

        for (let i = 1; i <= 3; i++) {
            const key = `dkg[${i}]`
            if (currentTracking[key]) {
                reportData.dkg.push(currentTracking[key].end - currentTracking[key].start)
            }
        }

        console.log(`✅ DKG for N=${N} completed.`)

        const NUM_TRANSACTIONS = 20
        console.log(`Starting ${NUM_TRANSACTIONS} TSS Proposals...`)

        const chainId = 'mainnet_1'
        const userId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

        for (let tx = 0; tx < NUM_TRANSACTIONS; tx++) {
            currentTracking = {}
            console.log(`Executing transaction ${tx + 1}/${NUM_TRANSACTIONS}...`)

            const shuffledNodes = [...nodesData].sort(() => 0.5 - Math.random())
            const proposers = shuffledNodes.slice(0, THRESHOLD)

            await Promise.all(
                proposers.map((node) =>
                    axios
                        .post(`${node.url}/tss/propose`, {
                            chainId,
                            userId,
                            amount: '100',
                        })
                        .catch((e) => {
                            const errMessage = e.response?.data?.message || e.message
                            console.log(`Propose error on node ${node.id}:`, errMessage)
                            throw e
                        })
                )
            )

            let tssDone = false
            while (!tssDone) {
                try {
                    const res = await axios.get(`${ORCH_URL}/fund/settlement-data`, {
                        params: { chainId },
                    })
                    if (res.data && res.data.signature && res.data.nonce > tx) {
                        tssDone = true
                    } else {
                        await delay(500)
                    }
                } catch (e) {
                    await delay(500)
                }
            }

            const txReport: any = { propose: [], tss: [], settlement: [] }
            for (let i = 1; i <= 2; i++) {
                const key = `propose[${i}]`
                if (currentTracking[key]) txReport.propose.push(currentTracking[key].end - currentTracking[key].start)
            }
            for (let i = 1; i <= 4; i++) {
                const key = `tss[${i}]`
                if (currentTracking[key]) txReport.tss.push(currentTracking[key].end - currentTracking[key].start)
            }
            for (let i = 1; i <= 1; i++) {
                const key = `settlement[${i}]`
                if (currentTracking[key])
                    txReport.settlement.push(currentTracking[key].end - currentTracking[key].start)
            }
            reportData.transactions.push(txReport)
        }

        console.log(`✅ All ${NUM_TRANSACTIONS} transactions completed for N=${N}.`)
    } catch (err: any) {
        console.error(`Error during benchmark N=${N}:`, err.message)
    } finally {
        console.log(`Cleaning up ${processes.length} processes...`)
        for (const child of processes) {
            child.kill('SIGKILL')
        }
        proxyServer.close()
        await delay(2000)
    }

    return reportData
}

const main = async () => {
    const finalReport: any = {}
    for (const N of SIZES) {
        finalReport[`N=${N}`] = await runBenchmark(N)
        fs.writeFileSync(path.join(__dirname, 'e2e-report.json'), JSON.stringify(finalReport, null, 2))
        await delay(2000)
    }
    console.log('All benchmarks completed. Report saved to e2e-report.json.')
    process.exit(0)
}

main()
