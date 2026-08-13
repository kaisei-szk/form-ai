import { RefreshCw } from 'lucide-react'

export default function Loading() {
  return (
    <div className="h-full flex items-center justify-center text-gray-400">
      <div className="flex items-center gap-2 text-sm">
        <RefreshCw className="w-4 h-4 animate-spin" />
        読み込み中...
      </div>
    </div>
  )
}
