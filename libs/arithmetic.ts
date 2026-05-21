import JsonStringify from 'json-stable-stringify'

import { BN, C } from '@common'

export const thresholdSame = <T>(arr: T[], t: number): T | null => {
    const hashMap: Record<string, number> = {}

    for (let i = 0; i < arr.length; i += 1) {
        const str = JsonStringify(arr[i])
        hashMap[str] = hashMap[str] ? hashMap[str] + 1 : 1

        if (hashMap[str] === t) {
            return arr[i]
        }
    }

    return null
}

export const kCombinations = (s: number | number[], k: number): number[][] => {
    let set = s

    if (typeof set === 'number') {
        set = Array.from({ length: set }, (_, i) => i)
    }

    if (k > set.length || k <= 0) {
        return []
    }

    if (k === set.length) {
        return [set]
    }

    if (k === 1) {
        return set.reduce((acc, cur) => [...acc, [cur]], [] as number[][])
    }

    const combs: number[][] = []
    let tailCombs: number[][] = []

    for (let i = 0; i <= set.length - k + 1; i += 1) {
        tailCombs = kCombinations(set.slice(i + 1), k - 1)
        for (let j = 0; j < tailCombs.length; j += 1) {
            combs.push([set[i], ...tailCombs[j]])
        }
    }
    return combs
}

export const lagrangeInterpolation = (points: Point[], x: string): string => {
    let result: BN = BN.ZERO
    const correspondingX: BN = BN.from(x)

    for (const currentPoint of points) {
        let upper = BN.ONE
        let lower = BN.ONE
        const currentX: BN = BN.from(currentPoint.x)
        const currentY: BN = BN.from(currentPoint.y)

        for (const anotherPoint of points) {
            const anotherX: BN = BN.from(anotherPoint.x)

            if (!currentX.eq(anotherX)) {
                upper = upper.mul(correspondingX.sub(anotherX)).umod(C.ORDER)

                let diff = currentX.sub(anotherX)

                diff = diff.umod(C.ORDER)
                lower = lower.mul(diff).umod(C.ORDER)
            }
        }

        let delta = upper.mul(lower.invm(C.ORDER)).umod(C.ORDER)
        delta = delta.mul(currentY).umod(C.ORDER)
        result = result.add(delta).umod(C.ORDER)
    }

    return result.toString('hex')
}

export const sumMod = (arr: string[], modulo: BN): string => {
    return arr.reduce((acc, current) => acc.add(BN.from(current)).umod(modulo), BN.ZERO).toString('hex')
}
