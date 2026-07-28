import { safeStorage } from 'electron'
import type { AppDatabase } from '../database.js'

export class KeyStore {
  constructor(private readonly database: AppDatabase) {}

  encrypt(apiKey: string): Buffer {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('当前系统无法使用安全存储，请检查 Windows 用户凭据服务')
    }
    return safeStorage.encryptString(apiKey.trim())
  }

  read(providerId: string): string {
    const encrypted = this.database.getEncryptedProviderKey(providerId)
    if (!encrypted) throw new Error('该供应商尚未配置 API Key')
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('当前系统无法解密 API Key')
    }
    return safeStorage.decryptString(encrypted)
  }

  readSearchService(): string {
    const encrypted = this.database.getEncryptedSearchServiceKey()
    if (!encrypted) throw new Error('豆包搜索尚未配置 API Key')
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('当前系统无法解密 API Key')
    }
    return safeStorage.decryptString(encrypted)
  }

  readWechatPublishSecret(): string {
    const encrypted = this.database.getEncryptedWechatPublishSecret()
    if (!encrypted) throw new Error('微信公众号尚未配置 AppSecret')
    if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法解密公众号 AppSecret')
    return safeStorage.decryptString(encrypted)
  }
}
