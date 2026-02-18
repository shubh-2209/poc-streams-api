import type { HttpContext } from '@adonisjs/core/http'
import User from '#models/user'
import { loginValidator, registerValidator } from '#validators/auth_validator'

export default class AuthController {
  async register({ request, response }: HttpContext) {
    const data = await request.validateUsing(registerValidator)

    const existing = await User.findBy('email', data.email)
    if (existing) {
      return response.conflict({
        error: 'Email already registered',
        message: 'This email is already in use. Please use a different email or login.',
      })
    }

    const sanitizedFullName = data.full_name.replace(/\s+/g, ' ').trim()

    if (sanitizedFullName.length < 3) {
      return response.badRequest({
        error: 'Invalid full name',
        message: 'Full name must be at least 3 characters after removing extra spaces',
      })
    }

    try {
      const user = await User.create({
        fullName: sanitizedFullName,
        email: data.email,
        password: data.password,
      })

      return response.created({
        message: 'Registration successful',
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
        },
      })
    } catch (error) {
      return response.internalServerError({
        error: 'Registration failed',
        message: 'An error occurred during registration. Please try again.',
      })
    }
  }

  async login({ request, response }: HttpContext) {
    const { email, password } = await request.validateUsing(loginValidator)

    const userExists = await User.findBy('email', email)
    if (!userExists) {
      return response.unauthorized({
        error: 'Invalid credentials',
        message: 'Email or password is incorrect',
      })
    }

    try {
      const user = await User.verifyCredentials(email, password)

      const token = await User.accessTokens.create(user, ['*'], {
        name: 'api_token',
        expiresIn: '30 days',
      })

      return response.ok({
        message: 'Login successful',
        token: token.value!.release(),
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
        },
      })
    } catch (error) {
      return response.unauthorized({
        error: 'Invalid credentials',
        message: 'Email or password is incorrect',
      })
    }
  }

  async logout({ auth, response }: HttpContext) {
    try {
      const user = await auth.authenticate()

      if (!user.currentAccessToken) {
        return response.badRequest({
          error: 'No active session',
          message: 'No active session found to logout',
        })
      }

      await User.accessTokens.delete(user, user.currentAccessToken.identifier)

      return response.ok({
        message: 'Logged out successfully',
      })
    } catch (error) {
      return response.unauthorized({
        error: 'Logout failed',
        message: 'Unable to logout. Please try again.',
      })
    }
  }

  async me({ auth, response }: HttpContext) {
    try {
      const user = await auth.authenticate()

      const userExists = await User.find(user.id)
      if (!userExists) {
        return response.notFound({
          error: 'User not found',
          message: 'User account no longer exists',
        })
      }

      return response.ok({
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          createdAt: user.createdAt,
        },
      })
    } catch (error) {
      return response.unauthorized({
        error: 'Authentication failed',
        message: 'Unable to fetch user details. Please login again.',
      })
    }
  }
}
