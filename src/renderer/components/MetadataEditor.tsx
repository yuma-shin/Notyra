import type React from 'react'
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FiX,
  FiPlus,
  FiFile,
  FiFolder,
  FiChevronRight,
  FiChevronDown,
} from 'react-icons/fi'
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  useDismiss,
  useClick,
  useInteractions,
  FloatingPortal,
} from '@floating-ui/react'
import { SimpleTooltip } from './editor/Tooltip'
import type { FolderNode } from '@/shared/types'

interface MetadataEditorProps {
  title: string
  tags: string[]
  filePath: string
  folderTree?: FolderNode
  currentFolder?: string
  onSave: (title: string, tags: string[]) => void
  onMove?: (targetFolder: string) => void
}

export function MetadataEditor({
  title,
  tags,
  filePath,
  folderTree,
  currentFolder = '',
  onSave,
  onMove,
}: MetadataEditorProps) {
  const { t } = useTranslation()
  const [editTitle, setEditTitle] = useState(title)
  const [editTags, setEditTags] = useState<string[]>(tags)
  const [newTag, setNewTag] = useState('')
  const [showTagInput, setShowTagInput] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set([''])
  ) // ルートは最初から展開
  const tagInputRef = useRef<HTMLInputElement>(null)

  const { refs, floatingStyles, context } = useFloating({
    open: isMenuOpen,
    onOpenChange: setIsMenuOpen,
    placement: 'bottom-start',
    middleware: [offset(4), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })

  const click = useClick(context)
  const dismiss = useDismiss(context)
  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
  ])

  useEffect(() => {
    setEditTitle(title)
    setEditTags(tags)
  }, [title, tags])

  // タイトルやタグが変更されたら自動保存
  useEffect(() => {
    const timer = setTimeout(() => {
      if (
        editTitle !== title ||
        JSON.stringify(editTags) !== JSON.stringify(tags)
      ) {
        onSave(editTitle, editTags)
      }
    }, 500) // 500ms後に保存

    return () => clearTimeout(timer)
  }, [editTitle, editTags, title, tags, onSave])

  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault()
    if (newTag.trim() && !editTags.includes(newTag.trim())) {
      setEditTags([...editTags, newTag.trim()])
      setNewTag('')
      setShowTagInput(false)
    }
  }

  const handleRemoveTag = (tagToRemove: string) => {
    setEditTags(editTags.filter(tag => tag !== tagToRemove))
  }

  // タグInput表示時にフォーカス
  useEffect(() => {
    if (showTagInput && tagInputRef.current) {
      tagInputRef.current.focus()
    }
  }, [showTagInput])

  const getFolderList = (
    node: FolderNode,
    prefix = ''
  ): Array<{
    path: string
    name: string
    depth: number
    hasChildren: boolean
    parentPath: string
  }> => {
    const folders: Array<{
      path: string
      name: string
      depth: number
      hasChildren: boolean
      parentPath: string
    }> = []
    const depth = prefix ? prefix.split('/').length : 0
    const parentPath = prefix
      ? prefix.substring(0, Math.max(prefix.lastIndexOf('/'), 0))
      : ''

    folders.push({
      path: prefix,
      name: prefix || t('metadata.root'),
      depth,
      hasChildren: node.children.length > 0,
      parentPath,
    })

    node.children.forEach(child => {
      const childPath = prefix ? `${prefix}/${child.name}` : child.name
      const childFolders = getFolderList(child, childPath)
      folders.push(...childFolders)
    })

    return folders
  }

  const toggleFolder = (path: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  const handleMoveToFolder = (targetFolder: string) => {
    if (onMove && targetFolder !== currentFolder) {
      onMove(targetFolder)
    }
    setIsMenuOpen(false)
  }

  const folderList = folderTree ? getFolderList(folderTree) : []

  // 表示するフォルダをフィルタリング（親が展開されている場合のみ表示）
  const visibleFolders = folderList.filter(folder => {
    if (folder.depth === 0) return true // ルートは常に表示
    return expandedFolders.has(folder.parentPath)
  })

  return (
    <div className="border-b border-gray-200 dark:border-gray-700 p-3 bg-white dark:bg-gray-900">
      <div className="space-y-2">
        <div>
          <input
            className="w-full text-xl font-bold bg-transparent border-none focus:outline-none focus:ring-0 p-0 text-gray-800 dark:text-gray-100"
            id="meta-title"
            onChange={e => setEditTitle(e.target.value)}
            placeholder={t('metadata.titlePlaceholder')}
            type="text"
            value={editTitle}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            {onMove && folderTree && (
              <>
                <SimpleTooltip content={t('metadata.moveFolder')}>
                  <button
                    ref={refs.setReference}
                    type="button"
                    {...getReferenceProps()}
                    className="flex items-center gap-1.5 px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                  >
                    <FiFolder size={12} />
                    <span className="text-gray-600 dark:text-gray-400">
                      {currentFolder || t('metadata.root')}
                    </span>
                  </button>
                </SimpleTooltip>
                <span className="text-gray-400 dark:text-gray-500">/</span>
                {isMenuOpen && (
                  <FloatingPortal>
                    <div
                      ref={refs.setFloating}
                      style={floatingStyles}
                      {...getFloatingProps()}
                      className="z-50 w-64 max-h-80 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1"
                    >
                      {visibleFolders.map(folder => {
                        const isExpanded = expandedFolders.has(folder.path)
                        return (
                          <div
                            className={`w-full text-left text-sm transition-colors flex items-center ${
                              folder.path === currentFolder
                                ? 'bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                                : 'text-gray-700 dark:text-gray-300'
                            }`}
                            key={folder.path}
                            style={{
                              paddingLeft: `${folder.depth * 12 + 8}px`,
                            }}
                          >
                            <div className="w-7 flex-shrink-0 flex items-center justify-center">
                              {folder.hasChildren && (
                                <button
                                  className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
                                  onClick={e => toggleFolder(folder.path, e)}
                                  type="button"
                                >
                                  {isExpanded ? (
                                    <FiChevronDown size={14} />
                                  ) : (
                                    <FiChevronRight size={14} />
                                  )}
                                </button>
                              )}
                            </div>
                            <button
                              className={`flex-1 px-2 py-2 text-left flex items-center gap-2 ${
                                folder.path === currentFolder
                                  ? 'cursor-not-allowed'
                                  : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                              }`}
                              disabled={folder.path === currentFolder}
                              onClick={() => handleMoveToFolder(folder.path)}
                              type="button"
                            >
                              <FiFolder size={14} />
                              <span>{folder.name}</span>
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </FloatingPortal>
                )}
              </>
            )}
            <FiFile size={12} />
            <span>{filePath.split(/[\\\\\\/]/).pop()}</span>
          </div>
          <div className="flex flex-wrap gap-1.5 items-center">
            {editTags.length === 0 && !showTagInput ? (
              <button
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-purple-600 dark:hover:text-purple-400 transition-colors flex items-center gap-1"
                onClick={() => setShowTagInput(true)}
                type="button"
              >
                <FiPlus size={12} />
                {t('metadata.clickCreateTag')}
              </button>
            ) : (
              <>
                {editTags.map((tag: string) => (
                  <span
                    className="px-1.5 py-0.5 text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded font-medium flex items-center gap-1"
                    key={tag}
                  >
                    {tag}
                    <button
                      className="hover:text-red-600 dark:hover:text-red-400 transition-colors"
                      onClick={e => {
                        e.stopPropagation()
                        handleRemoveTag(tag)
                      }}
                      type="button"
                    >
                      <FiX size={12} />
                    </button>
                  </span>
                ))}
                {showTagInput && (
                  <form
                    className="flex-1 min-w-[100px]"
                    onSubmit={handleAddTag}
                  >
                    <input
                      className="w-full px-1.5 py-0.5 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-purple-500 focus:border-purple-500"
                      onBlur={() => {
                        if (!newTag.trim()) {
                          setShowTagInput(false)
                        }
                      }}
                      onChange={e => setNewTag(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Escape') {
                          setNewTag('')
                          setShowTagInput(false)
                        }
                      }}
                      placeholder={t('metadata.tagPlaceholder')}
                      ref={tagInputRef}
                      type="text"
                      value={newTag}
                    />
                  </form>
                )}
                {editTags.length > 0 && !showTagInput && (
                  <SimpleTooltip content={t('metadata.addTagButton')}>
                    <button
                      className="p-0.5 text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded transition-colors"
                      onClick={() => setShowTagInput(true)}
                      type="button"
                    >
                      <FiPlus size={14} />
                    </button>
                  </SimpleTooltip>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
