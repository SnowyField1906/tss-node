export class TssProposeRequest {
    chainId: string
    userId: string
    amount: string
}
export class TssProposeResponse {
    messageHash: string
}

export class TssStartRequest {
    messageHash: string
    subsetIds: number[]
}
export class TssStartResponse {
    i: number
    E_k: string
    E_x: string
    Gamma: string
}

export class TssMtaRequest {
    messageHash: string
    others: {
        j: number
        E_k: string
        E_x: string
    }[]
}
export class TssMtaResponse {
    i: number
    alphas: {
        j: number
        alpha: string
    }[]
    nus: {
        j: number
        nu: string
    }[]
}

export class TssDeltaRequest {
    messageHash: string
    alphas: {
        j: number
        alpha: string
    }[]
    nus: {
        j: number
        nu: string
    }[]
}
export class TssDeltaResponse {
    i: number
    delta_i: string
}

export class TssSignRequest {
    messageHash: string
    r: string
}
export class TssSignResponse {
    i: number
    s_i: string
}
