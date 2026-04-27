export interface UpdateAvailablePayload {
  currentVersion: string
  latestVersion: string
  releaseUrl: string
  releaseName?: string
  publishedAt?: string
}
