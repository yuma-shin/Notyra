import { useTranslation } from 'react-i18next'
import { LuTriangleAlert } from 'react-icons/lu'
import { Dialog } from './ui/dialog'
import { Button } from './ui/button'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  onConfirm: () => void
  onCancel: () => void
  isDanger?: boolean
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  isDanger = false,
}: ConfirmDialogProps) {
  const { t } = useTranslation()
  const defaultConfirmText = confirmText || t('common.confirm')
  const defaultCancelText = cancelText || t('common.cancel')

  return (
    <Dialog
      onOpenChange={open => {
        if (!open) onCancel()
      }}
      open={isOpen}
      title={title}
    >
      <div className="flex items-start gap-3">
        {isDanger && (
          <LuTriangleAlert
            className="text-destructive flex-shrink-0 mt-0.5"
            size={24}
          />
        )}
        <p className="text-sm text-muted-foreground whitespace-pre-line">
          {message}
        </p>
      </div>
      <div className="flex justify-end gap-3 mt-4">
        <Button onClick={onCancel} variant="secondary">
          {defaultCancelText}
        </Button>
        <Button
          onClick={onConfirm}
          variant={isDanger ? 'destructive' : 'primary'}
        >
          {defaultConfirmText}
        </Button>
      </div>
    </Dialog>
  )
}
