import { HttpService } from '@nestjs/axios'
import { InternalServerErrorException } from '@nestjs/common'
import { AxiosResponse } from 'axios'
import { catchError, firstValueFrom, lastValueFrom } from 'rxjs'

export const post = async <T>(httpService: HttpService, url: string, data?: any): Promise<AxiosResponse<T>> => {
    return await firstValueFrom(
        httpService.post(url, data).pipe(
            catchError((error: any) => {
                console.error(error.message)
                throw new InternalServerErrorException(`Error at making POST to ${url}`)
            })
        )
    )
}

export const get = async <T>(httpService: HttpService, url: string, data?: any): Promise<AxiosResponse<T>> => {
    return await firstValueFrom(
        httpService.get(url, { params: data }).pipe(
            catchError((error: any) => {
                console.error(error.message)
                throw new InternalServerErrorException(`Error at making GET to ${url}`)
            })
        )
    )
}
