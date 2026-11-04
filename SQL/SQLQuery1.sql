IF DB_ID(N'sports_day_checkin') IS NULL
BEGIN
    CREATE DATABASE sports_day_checkin
    COLLATE Chinese_Taiwan_Stroke_CI_AS;
END
GO

USE sports_day_checkin;
GO

-- MASTER_PARTICIPANT
IF OBJECT_ID('dbo.MASTER_PARTICIPANT', 'U') IS NULL
BEGIN

    CREATE TABLE dbo.MASTER_PARTICIPANT
    (
        participant_id INT IDENTITY(1,1) NOT NULL,

        /* Google Form 原始資料 */
        form_timestamp DATETIME2(0) NULL,          -- 時間戳記
        email NVARCHAR(255) NULL,                 -- 電子郵件
        employee_no NVARCHAR(30) NOT NULL,        -- 員工工號
        employee_name NVARCHAR(100) NOT NULL,     -- 員工姓名
        department NVARCHAR(100) NULL,            -- 所屬部門
        team NVARCHAR(50) NULL,                   -- 所屬隊伍

        /* 系統產生 */
        seed_code NVARCHAR(100) NULL,              -- 種子碼 / 報到QR識別碼

        /* 報到目前狀態 */
        responsible_person NVARCHAR(30) NULL,      -- 最後報到負責人工號
        checkin_time DATETIME2(0) NULL,            -- 報到時間
        is_checked_in BIT NOT NULL
            CONSTRAINT DF_MASTER_is_checked_in DEFAULT 0, -- 是否報到 0/1

        /* 眷屬資料 */
        expected_guest_count TINYINT NOT NULL
            CONSTRAINT DF_MASTER_guest_count DEFAULT 0,   -- 預計同行眷屬

        guest1_name NVARCHAR(100) NULL,
        guest1_relation NVARCHAR(50) NULL,

        guest2_name NVARCHAR(100) NULL,
        guest2_relation NVARCHAR(50) NULL,

        guest3_name NVARCHAR(100) NULL,
        guest3_relation NVARCHAR(50) NULL,

        guest4_name NVARCHAR(100) NULL,
        guest4_relation NVARCHAR(50) NULL,

        /* 系統欄位 */
        created_at DATETIME2(0) NOT NULL
            CONSTRAINT DF_MASTER_created_at DEFAULT SYSDATETIME(),

        updated_at DATETIME2(0) NOT NULL
            CONSTRAINT DF_MASTER_updated_at DEFAULT SYSDATETIME(),

        CONSTRAINT PK_MASTER_PARTICIPANT
            PRIMARY KEY (participant_id),

        CONSTRAINT UQ_MASTER_PARTICIPANT_employee_no
            UNIQUE (employee_no),

        CONSTRAINT CK_MASTER_guest_count
            CHECK (expected_guest_count BETWEEN 0 AND 4)
    );

END;
GO
