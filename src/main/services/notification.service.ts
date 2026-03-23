import { Notification } from 'electron'

export function showNotification(title: string, body: string): void {
  new Notification({ title, body }).show()
}
