-- SIGN_RECEIPT
IF OBJECT_ID('dbo.SIGN_RECEIPT', 'U') IS NULL
BEGIN

    CREATE TABLE dbo.SIGN_RECEIPT
    (
        receipt_id BIGINT IDENTITY(1,1) NOT NULL,

        employee_no NVARCHAR(30) NOT NULL,

        receipt_token NVARCHAR(100) NULL,          -- 第二組：簽收二維碼

        actual_total_count_snapshot TINYINT NULL,  -- 確認當下人數

        amount_snapshot DECIMAL(10,2) NULL,        -- 確認當下金額

        member_confirmed BIT NOT NULL
            CONSTRAINT DF_RECEIPT_confirmed DEFAULT 0,

        member_confirmed_at DATETIME2(0) NULL,     -- 員工按 CHECK 時間

        receipt_status BIT NOT NULL
            CONSTRAINT DF_RECEIPT_status DEFAULT 0,
            -- 0 = 未領取
            -- 1 = 已領取

        receipt_operator NVARCHAR(30) NULL,        -- HR 工號

        receipt_time DATETIME2(0) NULL,            -- HR 實際發放時間

        created_at DATETIME2(0) NOT NULL
            CONSTRAINT DF_RECEIPT_created DEFAULT SYSDATETIME(),

        updated_at DATETIME2(0) NOT NULL
            CONSTRAINT DF_RECEIPT_updated DEFAULT SYSDATETIME(),

        CONSTRAINT PK_SIGN_RECEIPT
            PRIMARY KEY (receipt_id),

        CONSTRAINT FK_RECEIPT_MASTER
            FOREIGN KEY (employee_no)
            REFERENCES dbo.MASTER_PARTICIPANT(employee_no),

        CONSTRAINT CK_RECEIPT_amount
            CHECK (amount_snapshot IS NULL OR amount_snapshot >= 0)
    );

END;
GO