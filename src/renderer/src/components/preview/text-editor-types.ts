export interface TextEditorSelectionPayload {
  selector: string
  label: string
  elementTag: string
  text: string
  style: {
    color?: string
    fontSize?: string
    fontWeight?: string
    lineHeight?: string
    textAlign?: string
    backgroundColor?: string
  }
  bounds?: {
    x: number
    y: number
    width: number
    height: number
  }
}
