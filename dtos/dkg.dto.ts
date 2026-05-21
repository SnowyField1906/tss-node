export class BroadcastDkgRequest {
    t: number
    n: number
}
export class BroadcastDkgResponse {
    commitments: string[]
    data: {
        j: number
        encryptedPayload: Ecies // { s: string, t: string, n: string, g: string }
    }[]
}

export class ReceiveDkgDataRequest {
    shares: {
        i: number
        encryptedPayload: Ecies
        commitments: string[]
    }[]
}
export class ReceiveDkgDataResponse {
    feldmanCommitments: string[]
}

export class ComputePublicKeyRequest {
    feldmanCommitments: string[][]
}
export class ComputePublicKeyResponse {
    success: boolean
}
