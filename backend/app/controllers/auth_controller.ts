import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'

export default class AuthController {
    async register({ request, response }: HttpContext) {
        const { email, password, username } = request.only(['email', 'password', 'username'])
        const user = await User.create({ email, password, username })
        const token = await User.accessTokens.create(user)
        return response.created({ user, token })
    }

    async login({ request, response }: HttpContext) {
        const { email, password } = request.only(['email', 'password'])
        const user = await User.verifyCredentials(email, password)
        const token = await User.accessTokens.create(user)
        return response.ok({ user, token })
    }
}