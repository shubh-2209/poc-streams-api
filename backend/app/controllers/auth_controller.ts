import type { HttpContext } from '@adonisjs/core/http'
import { errors as authErrors } from '@adonisjs/auth'
import User from '#models/user'

export default class AuthController {
    /**
     * POST /api/auth/register
     * Body: { username, email, password }
     */
    async register({ request, response }: HttpContext) {
        try {
            const { username, email, password } = request.only(['username', 'email', 'password'])
            console.log('Request body:', { username, email, password })

            // Validate required fields
            if (!email || !password || !username) {
                return response.badRequest({
                    message: 'username, email and password are required',
                })
            }

            // Check if email already taken
            const existing = await User.findBy('email', email)
            console.log("existing", existing);
            if (existing) {
                return response.conflict({ message: 'Email is already registered' })
            }

            // Create user (password is auto-hashed via withAuthFinder mixin)
            const user = await User.create({ username, email, password })

            // Create access token
            const token = await User.accessTokens.create(user, ['*'], {
                expiresIn: '30 days',
            })

            return response.created({
                message: 'Account created successfully',
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                },
                token: {
                    token: token.value!.release(),
                    type: 'Bearer',
                },
            })
        } catch (error) {
            return response.internalServerError({
                message: 'Registration failed',
                error: error.message,
            })
        }
    }

    /**
     * POST /api/auth/login
     * Body: { email, password }
     */
    async login({ request, response }: HttpContext) {
        try {
            const { email, password } = request.only(['email', 'password'])

            if (!email || !password) {
                return response.badRequest({ message: 'Email and password are required' })
            }

            // verifyCredentials handles hashed password comparison
            const user = await User.verifyCredentials(email, password)

            // Create access token
            const token = await User.accessTokens.create(user, ['*'], {
                expiresIn: '30 days',
            })

            return response.ok({
                message: 'Login successful',
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                },
                token: {
                    token: token.value!.release(),
                    type: 'Bearer',
                },
            })
        } catch (error) {
            if (error instanceof authErrors.E_INVALID_CREDENTIALS) {
                return response.unauthorized({ message: 'Invalid email or password' })
            }
            return response.internalServerError({
                message: 'Login failed',
                error: error.message,
            })
        }
    }

    /**
     * GET /api/auth/me
     * Header: Authorization: Bearer <token>
     */
    async me({ auth, response }: HttpContext) {
        const user = auth.user
        if (!user) {
            return response.unauthorized({ message: 'Unauthorized: missing or invalid token' })
        }
        return response.ok({
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
            },
        })
    }

    /**
     * DELETE /api/auth/logout
     * Header: Authorization: Bearer <token>
     */
    async logout({ auth, response }: HttpContext) {
        const user = auth.user
        if (!user) {
            return response.unauthorized({ message: 'Unauthorized: missing or invalid token' })
        }
        await User.accessTokens.delete(user, auth.user!.$currentAccessToken.identifier)
        return response.ok({ message: 'Logged out successfully' })
    }
}