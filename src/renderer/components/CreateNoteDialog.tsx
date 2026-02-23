import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
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
          <h2 className="text-lg font-semibold">{t('dialog.createNote')}</h2>
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
              {t('dialog.noteName')}
            </label>
            <input
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              id="note-title"
              onChange={e => setTitle(e.target.value)}
              placeholder={t('dialog.noteName')}
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
              {t('common.cancel')}
            </button>
            <button
              className="px-4 py-2 text-white rounded-lg font-medium disabled:opacity-50"
              disabled={!title.trim()}
              onMouseEnter={e => {
                if (!e.currentTarget.disabled)
                  e.currentTarget.style.background = 'var(--theme-accent-hover)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'var(--theme-accent)'
              }}
              style={{ background: 'var(--theme-accent)' }}
              type="submit"
            >
              {t('common.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
