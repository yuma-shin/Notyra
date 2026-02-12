import type React from 'react'
import { useState } from 'react'
import { FiX } from 'react-icons/fi'

interface CreateNoteDialogProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (title: string) => void
}

export function CreateNoteDialog({
  isOpen,
  onClose,
  onSubmit,
}: CreateNoteDialogProps) {
  const [title, setTitle] = useState('')

  if (!isOpen) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (title.trim()) {
      onSubmit(title.trim())
      setTitle('')
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-lg font-semibold">新規ノートを作成</h2>
          <button
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
            onClick={onClose}
            type="button"
          >
            <FiX size={20} />
          </button>
        </div>
        <form className="p-6" onSubmit={handleSubmit}>
          <div className="mb-4">
            <label
              className="block text-sm font-medium mb-2"
              htmlFor="note-title"
            >
              ノートタイトル
            </label>
            <input
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              id="note-title"
              onChange={e => setTitle(e.target.value)}
              placeholder="ノートのタイトルを入力"
              type="text"
              value={title}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg"
              onClick={onClose}
              type="button"
            >
              キャンセル
            </button>
            <button
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white rounded-lg font-medium"
              disabled={!title.trim()}
              type="submit"
            >
              作成
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
