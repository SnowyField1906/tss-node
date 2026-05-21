import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type TssStateDocument = HydratedDocument<TssState>

@Schema({ timestamps: true })
export class TssState {
    @Prop({ required: true, unique: true })
    messageHash: string // Also serves as the session ID

    @Prop({ required: true })
    k_i: string // hex

    @Prop({ required: true })
    gamma_i: string // hex

    @Prop({ required: false })
    w_i: string // hex: x_i * lambda_{i,S}

    @Prop({ required: false })
    sigma_i: string // hex: computed in delta phase

    @Prop({ type: Object, default: {} })
    betas: {
        [toNodeId: string]: string // hex - for k*gamma MtA
    }

    @Prop({ type: Object, default: {} })
    alphas: {
        [fromNodeId: string]: string // hex
    }

    @Prop({ type: Object, default: {} })
    mus: {
        [toNodeId: string]: string // hex - for x*gamma MtA
    }

    @Prop({ type: Object, default: {} })
    nus: {
        [fromNodeId: string]: string // hex
    }
}

export const TssStateSchema = SchemaFactory.createForClass(TssState)
