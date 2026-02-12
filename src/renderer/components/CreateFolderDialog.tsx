import type React from 'react'
import { useState } from 'react'
import { FiX } from 'react-icons/fi'

interface CreateFolderDialogProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (folderName: string) => void
  currentPath: string
}

export function CreateFolderDialog({
  isOpen,
  onClose,
  onSubmit,
  currentPath,
}: CreateFolderDialogProps) {
  const [folderName, setFolderName] = useState('')

  if (!isOpen) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (folderName.trim()) {
      onSubmit(folderName.trim())
      setFolderName('')
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="text-lg font-semibold">新規フォルダを作成</h2>
          <button
            className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
            onClick={onClose}
            type="button"
          >
            <FiX size={20} />
          </button>
        </div>
        <form className="p-6" onSubmit={handleSubmit}>
          <div className="mb-2">
            <p className="block text-sm font-medium mb-2">作成場所</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {currentPath || '(ルート)'}
            </p>
          </div>
          <div className="mb-4">
            <label
              className="block text-sm font-medium mb-2"
              htmlFor="folder-name"
            >
              フォルダ名
            </label>
            <input
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              id="folder-name"
              onChange={e => setFolderName(e.target.value)}
              placeholder="フォルダ名を入力"
              type="text"
              value={folderName}
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
              disabled={!folderName.trim()}
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
